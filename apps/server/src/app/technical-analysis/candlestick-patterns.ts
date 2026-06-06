import { FyersAPI } from 'fyers-api-v3';
import {
  CandlestickPatternId,
  CandlestickPatternResult,
} from '../types/technical-analysis';

export type { CandlestickPatternId, CandlestickPatternResult };

function candleBody(c: FyersAPI.Candle): number {
  return Math.abs(c[4] - c[1]);
}

function candleRange(c: FyersAPI.Candle): number {
  return Math.max(0.01, c[2] - c[3]);
}

function isBullish(c: FyersAPI.Candle): boolean {
  return c[4] > c[1];
}

function isBearish(c: FyersAPI.Candle): boolean {
  return c[4] < c[1];
}

export function detectCandlestickPattern(
  candles: FyersAPI.Candle[],
): CandlestickPatternResult {
  const none: CandlestickPatternResult = {
    pattern: 'none',
    direction: 'neutral',
    scoreBoost: 0,
  };

  if (candles.length < 2) return none;

  const prev = candles[candles.length - 2];
  const curr = candles[candles.length - 1];

  const currBody = candleBody(curr);
  const currRange = candleRange(curr);
  const prevBody = candleBody(prev);

  const currUpper = curr[2] - Math.max(curr[1], curr[4]);
  const currLower = Math.min(curr[1], curr[4]) - curr[3];

  if (currRange > 0 && currBody / currRange < 0.1) {
    return { pattern: 'doji', direction: 'neutral', scoreBoost: 0 };
  }

  if (
    isBearish(prev) &&
    isBullish(curr) &&
    curr[4] > prev[1] &&
    curr[1] < prev[4] &&
    currBody > prevBody * 0.9
  ) {
    return {
      pattern: 'bullish_engulfing',
      direction: 'bullish',
      scoreBoost: 0.08,
    };
  }

  if (
    isBullish(prev) &&
    isBearish(curr) &&
    curr[4] < prev[1] &&
    curr[1] > prev[4] &&
    currBody > prevBody * 0.9
  ) {
    return {
      pattern: 'bearish_engulfing',
      direction: 'bearish',
      scoreBoost: -0.08,
    };
  }

  if (
    currBody > 0 &&
    currLower >= currBody * 2 &&
    currUpper <= currBody * 0.5
  ) {
    return { pattern: 'hammer', direction: 'bullish', scoreBoost: 0.06 };
  }

  if (
    currBody > 0 &&
    currUpper >= currBody * 2 &&
    currLower <= currBody * 0.5
  ) {
    return {
      pattern: 'shooting_star',
      direction: 'bearish',
      scoreBoost: -0.06,
    };
  }

  return none;
}

export function isOpposingCandlestick(
  action: 'CE-BUY' | 'PE-BUY',
  pattern: CandlestickPatternResult,
): boolean {
  if (pattern.pattern === 'none' || pattern.pattern === 'doji') return false;
  return action === 'CE-BUY'
    ? pattern.direction === 'bearish'
    : pattern.direction === 'bullish';
}