import { FastifyInstance } from 'fastify';
import { FYERS_OPTION_INDEX_SYMBOLS } from '../constants/fyers-symbols';
import { fetchAtmOptionContext } from '../position-sizing/atm-context';
import {
  calculatePositionSizing,
  confidenceRiskMultiplier,
  extractAvailableBalance,
  resolveBaseRiskPercent,
} from '../position-sizing/calculator';
import { ResponseStatus } from '../types/common';
import { TradeSetup } from '../types/technical-analysis';
import { TelegramPositionSizing } from '../types/telegram-notifications';
import { DecisionAction } from '../types/trade-decision';
import { TradingStyle } from '../types/trading-style';

function resolveOptionSide(action: DecisionAction): 'CE' | 'PE' | null {
  if (action === 'CE-BUY') return 'CE';
  if (action === 'PE-BUY') return 'PE';
  return null;
}

export async function resolveTelegramPositionSizing(
  fastify: FastifyInstance,
  params: {
    symbol: string;
    tradingStyle: TradingStyle;
    action: DecisionAction;
    signalConfidence: number;
    signalAction: string;
    tradeSetup?: TradeSetup | null;
  },
): Promise<TelegramPositionSizing> {
  const indexMeta = FYERS_OPTION_INDEX_SYMBOLS.find(
    (row) => row.symbol === params.symbol,
  );
  const lotSize = indexMeta?.lotSize ?? 1;
  const indexLabel = indexMeta?.shortName ?? params.symbol;

  const fundsRes = await fastify.fyers.get_funds();
  if (fundsRes.s !== ResponseStatus.ok) {
    return {
      availableBalance: null,
      totalBalance: null,
      lotSize,
      indexLabel,
      unavailableReason:
        fundsRes.message || 'Could not fetch Fyers account funds',
    };
  }

  const { available, total } = extractAvailableBalance(fundsRes.fund_limit);
  if (available <= 0) {
    return {
      availableBalance: 0,
      totalBalance: total,
      lotSize,
      indexLabel,
      unavailableReason: 'No available balance in Fyers account',
    };
  }

  const riskPoints = params.tradeSetup?.risk ?? 0;
  if (riskPoints <= 0) {
    return {
      availableBalance: available,
      totalBalance: total,
      lotSize,
      indexLabel,
      unavailableReason:
        'No active trade setup stop distance — lot sizing needs a CE/PE setup with defined risk',
    };
  }

  let baseRiskPercent = resolveBaseRiskPercent(params.tradingStyle);
  const confMult = confidenceRiskMultiplier(params.signalConfidence);
  const notes: string[] = [];

  if (params.signalAction === 'NO-TRADE' || confMult === 0) {
    notes.push(
      'Signal is NO-TRADE or low confidence — sizing shown for planning only.',
    );
  } else {
    baseRiskPercent = resolveBaseRiskPercent(
      params.tradingStyle,
      baseRiskPercent * confMult,
    );
    notes.push(
      `Risk % adjusted for signal confidence (${params.signalConfidence}% → ×${confMult}).`,
    );
  }

  const optionSide = resolveOptionSide(params.action);
  let atmPremium: number | null = null;
  let atmStrike: number | null = null;
  let deltaOverride: number | undefined;

  if (optionSide) {
    const atm = await fetchAtmOptionContext(
      fastify.fyers,
      params.symbol,
      optionSide,
    );
    if (atm) {
      atmPremium = atm.premium;
      atmStrike = atm.strike;
      if (atm.delta != null && atm.delta > 0) {
        deltaOverride = atm.delta;
      }
    } else {
      notes.push('ATM premium unavailable — margin estimate omitted.');
    }
  }

  const sizing = calculatePositionSizing({
    availableBalance: available,
    riskPercent: baseRiskPercent,
    riskPoints,
    lotSize,
    delta: deltaOverride,
    premium: atmPremium,
  });

  return {
    availableBalance: available,
    totalBalance: total,
    lotSize,
    indexLabel,
    riskPercent: baseRiskPercent,
    riskPoints,
    riskBudgetInr: sizing.riskBudgetInr,
    riskPerLotInr: sizing.riskPerLotInr,
    recommendedLots: sizing.recommendedLots,
    maxLotsByRisk: sizing.maxLotsByRisk,
    maxLotsByMargin: sizing.maxLotsByMargin,
    capitalAtRiskInr: sizing.capitalAtRiskInr,
    marginRequiredInr: sizing.marginRequiredInr,
    utilizationPercent: sizing.utilizationPercent,
    atmStrike,
    atmPremium,
    optionSide,
    tiers: sizing.tiers.map((tier) => ({
      label: tier.label,
      lots: tier.lots,
      capitalAtRiskInr: tier.capitalAtRiskInr,
      marginRequiredInr: tier.marginRequiredInr,
    })),
    notes: [...notes, ...sizing.notes],
  };
}