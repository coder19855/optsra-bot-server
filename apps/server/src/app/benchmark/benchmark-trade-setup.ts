import { normalizeStopLoss } from '../technical-analysis/stop-utils';
import {
  LIVE_TRADE_RR_LABELS,
  LIVE_TRADE_RR_MULTIPLIERS,
} from '../constants/trade-rr';
import {
  RrLabel,
  TradeAction,
  TradeSetup,
  TradeTakeProfitLevel,
} from '../types/technical-analysis';

/** Same RR ladder as live deck alerts (getConfluentTradeSignal). */
export const BENCHMARK_RR_LABELS: RrLabel[] = LIVE_TRADE_RR_LABELS;
export const BENCHMARK_RR_MULTIPLIERS = LIVE_TRADE_RR_MULTIPLIERS;

export function buildBenchmarkTradeSetup(
  action: TradeAction,
  entry: number,
  rawStopLoss: number,
  atr: number,
): TradeSetup | undefined {
  if (action === 'NO-TRADE' || entry <= 0 || rawStopLoss <= 0) {
    return undefined;
  }

  const { stopLoss, adjusted, reason } = normalizeStopLoss(
    action,
    entry,
    rawStopLoss,
    atr,
  );

  const risk =
    action === 'CE-BUY'
      ? Math.max(0.01, entry - stopLoss)
      : Math.max(0.01, stopLoss - entry);

  const takeProfits: TradeTakeProfitLevel[] = BENCHMARK_RR_MULTIPLIERS.map(
    (multiplier, index) => ({
      rr: BENCHMARK_RR_LABELS[index],
      multiplier,
      price:
        action === 'CE-BUY'
          ? +(entry + risk * multiplier).toFixed(2)
          : +(entry - risk * multiplier).toFixed(2),
    }),
  );

  return {
    entry: +entry.toFixed(2),
    stopLoss: +stopLoss.toFixed(2),
    rawStopLoss: +rawStopLoss.toFixed(2),
    risk: +risk.toFixed(2),
    takeProfits,
    atrUsed: +atr.toFixed(2),
    stopAdjusted: adjusted,
    stopAdjustReason: reason,
  };
}