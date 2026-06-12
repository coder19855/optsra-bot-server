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

function upperWick(c: FyersAPI.Candle): number {
  return c[2] - Math.max(c[1], c[4]);
}

function lowerWick(c: FyersAPI.Candle): number {
  return Math.min(c[1], c[4]) - c[3];
}

const NONE: CandlestickPatternResult = {
  pattern: 'none',
  direction: 'neutral',
  scoreBoost: 0,
};

function recentTrend(candles: FyersAPI.Candle[], lookback = 5): number {
  if (candles.length < lookback + 1) return 0;
  const slice = candles.slice(-(lookback + 1), -1);
  return slice[slice.length - 1][4] - slice[0][1];
}

function detectThreeCandlePatterns(
  candles: FyersAPI.Candle[],
): CandlestickPatternResult | null {
  if (candles.length < 3) return null;

  const c1 = candles[candles.length - 3];
  const c2 = candles[candles.length - 2];
  const c3 = candles[candles.length - 1];

  const c1Body = candleBody(c1);
  const c2Body = candleBody(c2);
  const c3Body = candleBody(c3);
  const c1Mid = (c1[1] + c1[4]) / 2;

  if (
    isBearish(c1) &&
    c1Body > candleRange(c1) * 0.35 &&
    c2Body < candleRange(c2) * 0.35 &&
    isBullish(c3) &&
    c3[4] > c1Mid &&
    c3Body > candleRange(c3) * 0.35
  ) {
    return {
      pattern: 'morning_star',
      direction: 'bullish',
      scoreBoost: 0.09,
    };
  }

  if (
    isBullish(c1) &&
    c1Body > candleRange(c1) * 0.35 &&
    c2Body < candleRange(c2) * 0.35 &&
    isBearish(c3) &&
    c3[4] < c1Mid &&
    c3Body > candleRange(c3) * 0.35
  ) {
    return {
      pattern: 'evening_star',
      direction: 'bearish',
      scoreBoost: -0.09,
    };
  }

  if (isBullish(c1) && isBullish(c2) && isBullish(c3)) {
    const rising =
      c2[4] > c1[4] &&
      c3[4] > c2[4] &&
      c2[1] >= c1[1] &&
      c2[1] <= c1[4] &&
      c3[1] >= c2[1] &&
      c3[1] <= c2[4];
    if (rising) {
      return {
        pattern: 'three_white_soldiers',
        direction: 'bullish',
        scoreBoost: 0.07,
      };
    }
  }

  if (isBearish(c1) && isBearish(c2) && isBearish(c3)) {
    const falling =
      c2[4] < c1[4] &&
      c3[4] < c2[4] &&
      c2[1] <= c1[1] &&
      c2[1] >= c1[4] &&
      c3[1] <= c2[1] &&
      c3[1] >= c2[4];
    if (falling) {
      return {
        pattern: 'three_black_crows',
        direction: 'bearish',
        scoreBoost: -0.07,
      };
    }
  }

  return null;
}

function detectTwoCandlePatterns(
  candles: FyersAPI.Candle[],
): CandlestickPatternResult | null {
  if (candles.length < 2) return null;

  const prev = candles[candles.length - 2];
  const curr = candles[candles.length - 1];

  const currBody = candleBody(curr);
  const prevBody = candleBody(prev);
  const prevMid = (prev[1] + prev[4]) / 2;

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
    isBearish(prev) &&
    isBullish(curr) &&
    curr[1] < prev[4] &&
    curr[4] > prevMid &&
    curr[4] < prev[1]
  ) {
    return {
      pattern: 'piercing_line',
      direction: 'bullish',
      scoreBoost: 0.06,
    };
  }

  if (
    isBullish(prev) &&
    isBearish(curr) &&
    curr[1] > prev[4] &&
    curr[4] < prevMid &&
    curr[4] > prev[1]
  ) {
    return {
      pattern: 'dark_cloud_cover',
      direction: 'bearish',
      scoreBoost: -0.06,
    };
  }

  if (prevBody > 0 && currBody > 0) {
    const inside =
      Math.max(curr[1], curr[4]) <= Math.max(prev[1], prev[4]) &&
      Math.min(curr[1], curr[4]) >= Math.min(prev[1], prev[4]) &&
      currBody < prevBody * 0.65;
    if (inside) {
      if (isBullish(curr)) {
        return {
          pattern: 'bullish_harami',
          direction: 'bullish',
          scoreBoost: 0.05,
        };
      }
      if (isBearish(curr)) {
        return {
          pattern: 'bearish_harami',
          direction: 'bearish',
          scoreBoost: -0.05,
        };
      }
    }
  }

  return null;
}

function detectSingleCandlePatterns(
  candles: FyersAPI.Candle[],
): CandlestickPatternResult {
  const curr = candles[candles.length - 1];
  const currBody = candleBody(curr);
  const currRange = candleRange(curr);
  const currUpper = upperWick(curr);
  const currLower = lowerWick(curr);

  if (currRange > 0 && currBody / currRange < 0.1) {
    return { pattern: 'doji', direction: 'neutral', scoreBoost: 0 };
  }

  if (
    currBody > 0 &&
    currUpper >= currBody * 0.8 &&
    currLower >= currBody * 0.8 &&
    currBody / currRange < 0.35
  ) {
    return { pattern: 'spinning_top', direction: 'neutral', scoreBoost: 0 };
  }

  if (
    currBody > 0 &&
    currLower >= currBody * 2 &&
    currUpper <= currBody * 0.5
  ) {
    if (recentTrend(candles) < 0) {
      return { pattern: 'hammer', direction: 'bullish', scoreBoost: 0.06 };
    }
    return {
      pattern: 'inverted_hammer',
      direction: 'bullish',
      scoreBoost: 0.05,
    };
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

  return NONE;
}

export function detectCandlestickPattern(
  candles: FyersAPI.Candle[],
): CandlestickPatternResult {
  if (candles.length < 2) return NONE;

  return (
    detectThreeCandlePatterns(candles) ??
    detectTwoCandlePatterns(candles) ??
    detectSingleCandlePatterns(candles)
  );
}

export function isOpposingCandlestick(
  action: 'CE-BUY' | 'PE-BUY',
  pattern: CandlestickPatternResult,
): boolean {
  if (
    pattern.pattern === 'none' ||
    pattern.pattern === 'doji' ||
    pattern.pattern === 'spinning_top'
  ) {
    return false;
  }
  return action === 'CE-BUY'
    ? pattern.direction === 'bearish'
    : pattern.direction === 'bullish';
}