import { TIMELINE_STOP_ATR } from '../constants/technical-analysis';
import { TradeAction } from '../types/technical-analysis';

export function normalizeStopLoss(
  action: TradeAction,
  entry: number,
  rawStopLoss: number,
  atr: number,
): { stopLoss: number; adjusted: boolean; reason?: string } {
  if (action === 'NO-TRADE' || entry <= 0 || rawStopLoss <= 0 || atr <= 0) {
    return { stopLoss: rawStopLoss, adjusted: false };
  }

  const minRisk = TIMELINE_STOP_ATR.MIN_MULT * atr;
  const maxRisk = TIMELINE_STOP_ATR.MAX_MULT * atr;

  if (action === 'CE-BUY') {
    const rawRisk = entry - rawStopLoss;
    if (rawRisk < minRisk) {
      return {
        stopLoss: +(entry - minRisk).toFixed(2),
        adjusted: true,
        reason: `Widened to ${TIMELINE_STOP_ATR.MIN_MULT}x ATR (${minRisk.toFixed(1)} pts); swing stop was too tight`,
      };
    }
    if (rawRisk > maxRisk) {
      return {
        stopLoss: +(entry - maxRisk).toFixed(2),
        adjusted: true,
        reason: `Tightened to ${TIMELINE_STOP_ATR.MAX_MULT}x ATR (${maxRisk.toFixed(1)} pts); swing stop was stale/wide`,
      };
    }
  } else {
    const rawRisk = rawStopLoss - entry;
    if (rawRisk < minRisk) {
      return {
        stopLoss: +(entry + minRisk).toFixed(2),
        adjusted: true,
        reason: `Widened to ${TIMELINE_STOP_ATR.MIN_MULT}x ATR (${minRisk.toFixed(1)} pts); swing stop was too tight`,
      };
    }
    if (rawRisk > maxRisk) {
      return {
        stopLoss: +(entry + maxRisk).toFixed(2),
        adjusted: true,
        reason: `Tightened to ${TIMELINE_STOP_ATR.MAX_MULT}x ATR (${maxRisk.toFixed(1)} pts); swing stop was stale/wide`,
      };
    }
  }

  return { stopLoss: +rawStopLoss.toFixed(2), adjusted: false };
}