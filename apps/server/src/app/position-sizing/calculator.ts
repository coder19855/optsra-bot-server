import { POSITION_SIZING_DEFAULTS } from '../constants/position-sizing';
import { PositionSizingTier } from '../types/position-sizing';
import { TradingStyle } from '../types/trading-style';

export function extractAvailableBalance(
  fundLimits: Array<{ title: string; equityAmount: number }>,
): { available: number; total: number | null } {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

  const availableRow = fundLimits.find((f) => {
    const t = norm(f.title);
    return t.includes('available') && !t.includes('commodity');
  });

  const totalRow = fundLimits.find((f) => {
    const t = norm(f.title);
    return t === 'total balance' || t.includes('total balance');
  });

  const available =
    availableRow?.equityAmount ??
    totalRow?.equityAmount ??
    fundLimits[0]?.equityAmount ??
    0;

  return {
    available: Math.max(0, available),
    total: totalRow?.equityAmount ?? null,
  };
}

export function confidenceRiskMultiplier(confidence: number): number {
  if (confidence >= 72) return 1;
  if (confidence >= 48) return 0.75;
  if (confidence >= 30) return 0.5;
  return 0;
}

export function clampRiskPercent(value: number): number {
  return Math.min(
    POSITION_SIZING_DEFAULTS.MAX_RISK_PERCENT,
    Math.max(POSITION_SIZING_DEFAULTS.MIN_RISK_PERCENT, value),
  );
}

export function resolveBaseRiskPercent(
  style: TradingStyle,
  override?: number,
): number {
  if (override !== undefined && Number.isFinite(override) && override > 0) {
    return clampRiskPercent(override);
  }
  return POSITION_SIZING_DEFAULTS.RISK_BY_STYLE[style];
}

export interface SizingCalcInput {
  availableBalance: number;
  riskPercent: number;
  riskPoints: number;
  lotSize: number;
  delta?: number;
  premium?: number | null;
}

export interface SizingCalcResult {
  riskBudgetInr: number;
  riskPerLotInr: number;
  maxLotsByRisk: number;
  maxLotsByMargin: number | null;
  recommendedLots: number;
  capitalAtRiskInr: number;
  marginRequiredInr: number | null;
  utilizationPercent: number | null;
  tiers: PositionSizingTier[];
  notes: string[];
}

export function calculatePositionSizing(
  input: SizingCalcInput,
): SizingCalcResult {
  const {
    availableBalance,
    riskPercent,
    riskPoints,
    lotSize,
    delta = POSITION_SIZING_DEFAULTS.DEFAULT_DELTA,
    premium = null,
  } = input;

  const notes: string[] = [];
  const riskBudgetInr = (availableBalance * riskPercent) / 100;
  const riskPerLotInr = Math.max(1, riskPoints * lotSize * delta);
  const maxLotsByRisk = Math.max(0, Math.floor(riskBudgetInr / riskPerLotInr));

  let maxLotsByMargin: number | null = null;

  if (premium !== null && premium > 0) {
    const marginPerLot = premium * lotSize;
    const deployable =
      (availableBalance *
        POSITION_SIZING_DEFAULTS.MAX_CAPITAL_UTILIZATION_PERCENT) /
      100;
    maxLotsByMargin = Math.max(0, Math.floor(deployable / marginPerLot));
    notes.push(
      `Margin cap uses ${POSITION_SIZING_DEFAULTS.MAX_CAPITAL_UTILIZATION_PERCENT}% of available balance and premium × lot size (buy-side estimate).`,
    );
  } else {
    notes.push(
      'Pass `premium` (option LTP) for margin-based lot cap; risk-only sizing used for now.',
    );
  }

  let recommendedLots = maxLotsByRisk;
  if (maxLotsByMargin !== null) {
    recommendedLots = Math.min(maxLotsByRisk, maxLotsByMargin);
  }

  if (recommendedLots < 1 && maxLotsByRisk >= 1 && maxLotsByMargin === 0) {
    notes.push(
      'Risk budget allows lots, but premium-based margin cap is zero — lower premium strike or add funds.',
    );
  }

  if (maxLotsByRisk < 1) {
    notes.push(
      'Risk budget too small for 1 lot at current stop distance — widen stop, add capital, or skip trade.',
    );
    recommendedLots = 0;
  }

  const capitalAtRiskInr = +(recommendedLots * riskPerLotInr).toFixed(2);
  const marginRequiredInr =
    premium !== null && premium > 0 && recommendedLots > 0
      ? +(recommendedLots * premium * lotSize).toFixed(2)
      : null;

  const utilizationPercent =
    marginRequiredInr !== null && availableBalance > 0
      ? +((marginRequiredInr / availableBalance) * 100).toFixed(2)
      : null;

  const tiers: PositionSizingTier[] = (
    Object.entries(POSITION_SIZING_DEFAULTS.TIER_MULTIPLIERS) as Array<
      [PositionSizingTier['label'], number]
    >
  ).map(([label, mult]) => {
    const tierRiskPct = clampRiskPercent(riskPercent * mult);
    const tierBudget = (availableBalance * tierRiskPct) / 100;
    const tierLotsByRisk = Math.floor(tierBudget / riskPerLotInr);
    let tierLots = tierLotsByRisk;
    if (maxLotsByMargin !== null) {
      tierLots = Math.min(tierLotsByRisk, maxLotsByMargin);
    }
    if (tierLotsByRisk < 1) tierLots = 0;

    return {
      label,
      riskPercent: +tierRiskPct.toFixed(2),
      lots: tierLots,
      capitalAtRiskInr: +(tierLots * riskPerLotInr).toFixed(2),
      marginRequiredInr:
        premium !== null && premium > 0 && tierLots > 0
          ? +(tierLots * premium * lotSize).toFixed(2)
          : null,
    };
  });

  notes.push(
    `Risk per lot ≈ index risk (${riskPoints.toFixed(1)} pts) × lot (${lotSize}) × delta (${delta}).`,
  );

  return {
    riskBudgetInr: +riskBudgetInr.toFixed(2),
    riskPerLotInr: +riskPerLotInr.toFixed(2),
    maxLotsByRisk,
    maxLotsByMargin,
    recommendedLots,
    capitalAtRiskInr,
    marginRequiredInr,
    utilizationPercent,
    tiers,
    notes,
  };
}