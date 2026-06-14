import { POSITION_SIZING_DEFAULTS } from '../constants/position-sizing';
import { BENCHMARK_DEFAULT_STARTING_CAPITAL_INR } from '../constants/benchmark';
import { computeDrawdownFromSeries } from '../technical-analysis/trailing-tp-policy';
import { TradingStyle } from '../types/trading-style';
import { BenchmarkCapitalSummary, BenchmarkTradeRow } from './types';

export function resolveBenchmarkRiskPercent(
  tradingStyle: TradingStyle,
  override?: number,
): number {
  if (override != null && Number.isFinite(override) && override > 0) {
    return Math.min(
      POSITION_SIZING_DEFAULTS.MAX_RISK_PERCENT,
      Math.max(POSITION_SIZING_DEFAULTS.MIN_RISK_PERCENT, override),
    );
  }
  return POSITION_SIZING_DEFAULTS.RISK_BY_STYLE[tradingStyle];
}

export function buildCapitalProjection(
  trades: BenchmarkTradeRow[],
  tradingStyle: TradingStyle,
  startingCapitalInr: number = BENCHMARK_DEFAULT_STARTING_CAPITAL_INR,
  riskPercentOverride?: number,
): {
  summary: BenchmarkCapitalSummary;
  capitalCurve: Array<{ t: number; capitalInr: number; pnlInr: number; label: string }>;
  trades: BenchmarkTradeRow[];
} {
  const riskPercent = resolveBenchmarkRiskPercent(tradingStyle, riskPercentOverride);
  let capital = startingCapitalInr;
  const capitalCurve: Array<{
    t: number;
    capitalInr: number;
    pnlInr: number;
    label: string;
  }> = [
    {
      t: trades[0]?.signalAtMs ?? Date.now(),
      capitalInr: startingCapitalInr,
      pnlInr: 0,
      label: 'Start',
    },
  ];

  const enriched = trades.map((trade) => {
    const riskBudgetInr = +((capital * riskPercent) / 100).toFixed(2);
    const pnlInr = +(riskBudgetInr * trade.pnlR).toFixed(2);
    capital = +(capital + pnlInr).toFixed(2);
    capitalCurve.push({
      t: trade.signalAtMs,
      capitalInr: capital,
      pnlInr,
      label: `${trade.action} ${trade.hitLevel}`,
    });
    return { ...trade, riskBudgetInr, pnlInr };
  });

  const endingCapitalInr = capital;
  const netPnlInr = +(endingCapitalInr - startingCapitalInr).toFixed(2);
  const netPnlPercent =
    startingCapitalInr > 0
      ? +((netPnlInr / startingCapitalInr) * 100).toFixed(2)
      : 0;

  const capitalDd = computeDrawdownFromSeries(
    capitalCurve.map((p) => p.capitalInr),
  );
  let cumulativeR = 0;
  const rSeries = trades.map((t) => {
    cumulativeR += t.pnlR;
    return cumulativeR;
  });
  const rDd = computeDrawdownFromSeries(rSeries);

  return {
    summary: {
      startingCapitalInr,
      endingCapitalInr,
      netPnlInr,
      netPnlPercent,
      riskPercentPerTrade: riskPercent,
      compounding: true,
      maxDrawdownInr: capitalDd.maxDrawdown,
      maxDrawdownPercent: capitalDd.maxDrawdownPercent,
      maxDrawdownR: rDd.maxDrawdown,
      note: `Each trade risks ${riskPercent}% of running capital; P&L = risk budget × R-multiple. Max DD from equity peak.`,
    },
    capitalCurve,
    trades: enriched,
  };
}

export const BENCHMARK_STOP_LOSS_NOTE =
  'SL: last opposing swing (CE→swing low/support, PE→swing high/resistance), clamped to 0.35–1.5× ATR. TPs at 1.5R/2.5R/4R — past 4R trail ratchets at peakR − 1R until flip or floor.';