import { FyersAPI } from 'fyers-api-v3';
import { ChartPatternId, ChartPatternResult } from '../types/technical-analysis';
import { Swing } from '../types/technical-analysis';

const NONE: ChartPatternResult = {
  pattern: 'none',
  direction: 'neutral',
  scoreBoost: 0,
};

function priceTolerance(price: number): number {
  return Math.max(price * 0.0025, 8);
}

function barRange(c: FyersAPI.Candle): number {
  return Math.max(0.01, c[2] - c[3]);
}

/** Major chart patterns on primary TF — used for confluence scoring and opposing gates. */
export function detectChartPattern(
  candles: FyersAPI.Candle[],
  swings: Swing,
  support: number,
  resistance: number,
): ChartPatternResult {
  if (candles.length < 20) return NONE;

  const lastClose = candles[candles.length - 1][4];

  const headAndShoulders = detectHeadAndShoulders(swings, lastClose);
  if (headAndShoulders) return headAndShoulders;

  const inverseHs = detectInverseHeadAndShoulders(swings, lastClose);
  if (inverseHs) return inverseHs;

  const doubleTop = detectDoubleTop(swings, lastClose);
  if (doubleTop) return doubleTop;

  const doubleBottom = detectDoubleBottom(swings, lastClose);
  if (doubleBottom) return doubleBottom;

  const wedge = detectWedge(candles);
  if (wedge) return wedge;

  const flag = detectFlagPennant(candles);
  if (flag) return flag;

  const triangle = detectTriangle(candles);
  if (triangle) return triangle;

  const rangeBreak = detectRangeBreakout(candles, support, resistance);
  if (rangeBreak) return rangeBreak;

  const trendBreak = detectTrendlineBreak(candles, swings);
  if (trendBreak) return trendBreak;

  return NONE;
}

function detectHeadAndShoulders(
  swings: Swing,
  lastClose: number,
): ChartPatternResult | null {
  const highs = swings.highs;
  if (highs.length < 3) return null;

  const left = highs[highs.length - 3];
  const head = highs[highs.length - 2];
  const right = highs[highs.length - 1];
  if (right.index - left.index < 8) return null;

  const tol = priceTolerance(head.price);
  const shouldersSimilar = Math.abs(left.price - right.price) <= tol;
  const headHigher =
    head.price > left.price + tol && head.price > right.price + tol;
  if (!shouldersSimilar || !headHigher) return null;

  const lowsBetween = swings.lows.filter(
    (l) => l.index > left.index && l.index < right.index,
  );
  const neckline =
    lowsBetween.length > 0
      ? Math.min(...lowsBetween.map((l) => l.price))
      : Math.min(left.price, right.price) - tol * 2;

  if (lastClose < neckline) {
    return {
      pattern: 'head_and_shoulders',
      direction: 'bearish',
      scoreBoost: -0.12,
      status: 'confirmed',
    };
  }

  return {
    pattern: 'head_and_shoulders',
    direction: 'bearish',
    scoreBoost: -0.05,
    status: 'forming',
  };
}

function detectInverseHeadAndShoulders(
  swings: Swing,
  lastClose: number,
): ChartPatternResult | null {
  const lows = swings.lows;
  if (lows.length < 3) return null;

  const left = lows[lows.length - 3];
  const head = lows[lows.length - 2];
  const right = lows[lows.length - 1];
  if (right.index - left.index < 8) return null;

  const tol = priceTolerance(head.price);
  const shouldersSimilar = Math.abs(left.price - right.price) <= tol;
  const headLower =
    head.price < left.price - tol && head.price < right.price - tol;
  if (!shouldersSimilar || !headLower) return null;

  const highsBetween = swings.highs.filter(
    (h) => h.index > left.index && h.index < right.index,
  );
  const neckline =
    highsBetween.length > 0
      ? Math.max(...highsBetween.map((h) => h.price))
      : Math.max(left.price, right.price) + tol * 2;

  if (lastClose > neckline) {
    return {
      pattern: 'inverse_head_and_shoulders',
      direction: 'bullish',
      scoreBoost: 0.12,
      status: 'confirmed',
    };
  }

  return {
    pattern: 'inverse_head_and_shoulders',
    direction: 'bullish',
    scoreBoost: 0.05,
    status: 'forming',
  };
}

function detectDoubleTop(
  swings: Swing,
  lastClose: number,
): ChartPatternResult | null {
  const highs = swings.highs;
  if (highs.length < 2) return null;

  const h1 = highs[highs.length - 2];
  const h2 = highs[highs.length - 1];
  if (h2.index - h1.index < 5) return null;

  const tol = priceTolerance(h1.price);
  if (Math.abs(h1.price - h2.price) > tol) return null;

  const lowsBetween = swings.lows.filter(
    (l) => l.index > h1.index && l.index < h2.index,
  );
  const neckline =
    lowsBetween.length > 0
      ? Math.min(...lowsBetween.map((l) => l.price))
      : Math.min(h1.price, h2.price) - tol * 2;

  if (lastClose < neckline) {
    return {
      pattern: 'double_top',
      direction: 'bearish',
      scoreBoost: -0.1,
      status: 'confirmed',
    };
  }

  return {
    pattern: 'double_top',
    direction: 'bearish',
    scoreBoost: -0.04,
    status: 'forming',
  };
}

function detectDoubleBottom(
  swings: Swing,
  lastClose: number,
): ChartPatternResult | null {
  const lows = swings.lows;
  if (lows.length < 2) return null;

  const l1 = lows[lows.length - 2];
  const l2 = lows[lows.length - 1];
  if (l2.index - l1.index < 5) return null;

  const tol = priceTolerance(l1.price);
  if (Math.abs(l1.price - l2.price) > tol) return null;

  const highsBetween = swings.highs.filter(
    (h) => h.index > l1.index && h.index < l2.index,
  );
  const neckline =
    highsBetween.length > 0
      ? Math.max(...highsBetween.map((h) => h.price))
      : Math.max(l1.price, l2.price) + tol * 2;

  if (lastClose > neckline) {
    return {
      pattern: 'double_bottom',
      direction: 'bullish',
      scoreBoost: 0.1,
      status: 'confirmed',
    };
  }

  return {
    pattern: 'double_bottom',
    direction: 'bullish',
    scoreBoost: 0.04,
    status: 'forming',
  };
}

function detectWedge(candles: FyersAPI.Candle[]): ChartPatternResult | null {
  const window = candles.slice(-20);
  if (window.length < 20) return null;

  const early = window.slice(0, 8);
  const late = window.slice(-8);

  const earlyHigh = Math.max(...early.map((c) => c[2]));
  const lateHigh = Math.max(...late.map((c) => c[2]));
  const earlyLow = Math.min(...early.map((c) => c[3]));
  const lateLow = Math.min(...late.map((c) => c[3]));

  const highsRising = lateHigh > earlyHigh * 1.002;
  const lowsRisingFaster =
    lateLow > earlyLow * 1.004 &&
    lateLow - earlyLow > (lateHigh - earlyHigh) * 1.2;

  if (highsRising && lowsRisingFaster) {
    return {
      pattern: 'rising_wedge',
      direction: 'bearish',
      scoreBoost: -0.07,
      status: 'forming',
    };
  }

  const highsFalling = lateHigh < earlyHigh * 0.998;
  const lowsFallingFaster =
    lateLow < earlyLow * 0.996 &&
    earlyLow - lateLow > (earlyHigh - lateHigh) * 1.2;

  if (highsFalling && lowsFallingFaster) {
    return {
      pattern: 'falling_wedge',
      direction: 'bullish',
      scoreBoost: 0.07,
      status: 'forming',
    };
  }

  return null;
}

function detectFlagPennant(
  candles: FyersAPI.Candle[],
): ChartPatternResult | null {
  if (candles.length < 24) return null;

  const impulse = candles.slice(-24, -8);
  const consolidation = candles.slice(-8);

  const impulseRanges = impulse.map(barRange);
  const consRanges = consolidation.map(barRange);
  const impulseAvg =
    impulseRanges.reduce((a, b) => a + b, 0) / impulseRanges.length;
  const consAvg = consRanges.reduce((a, b) => a + b, 0) / consRanges.length;

  if (impulseAvg <= 0 || consAvg / impulseAvg > 0.72) return null;

  const impulseMove = impulse[impulse.length - 1][4] - impulse[0][1];
  const narrowing =
    consRanges[0] > consRanges[consRanges.length - 1] * 1.15;

  if (!narrowing) return null;

  if (impulseMove > impulseAvg * 2) {
    return {
      pattern: 'bull_flag',
      direction: 'bullish',
      scoreBoost: 0.08,
      status: 'forming',
    };
  }

  if (impulseMove < -impulseAvg * 2) {
    return {
      pattern: 'bear_flag',
      direction: 'bearish',
      scoreBoost: -0.08,
      status: 'forming',
    };
  }

  return null;
}

function detectTriangle(
  candles: FyersAPI.Candle[],
): ChartPatternResult | null {
  const window = candles.slice(-15);
  if (window.length < 15) return null;

  const highs = window.map((c) => c[2]);
  const lows = window.map((c) => c[3]);

  const earlyHigh = Math.max(...highs.slice(0, 5));
  const lateHigh = Math.max(...highs.slice(-5));
  const earlyLow = Math.min(...lows.slice(0, 5));
  const lateLow = Math.min(...lows.slice(-5));

  const highsFalling = lateHigh < earlyHigh * 0.998;
  const lowsRising = lateLow > earlyLow * 1.002;

  if (highsFalling && lowsRising) {
    return {
      pattern: 'triangle_symmetric',
      direction: 'neutral',
      scoreBoost: 0,
      status: 'forming',
    };
  }

  if (
    highsFalling &&
    !lowsRising &&
    Math.abs(lateLow - earlyLow) < earlyLow * 0.003
  ) {
    return {
      pattern: 'triangle_descending',
      direction: 'bearish',
      scoreBoost: -0.06,
      status: 'forming',
    };
  }

  if (
    lowsRising &&
    !highsFalling &&
    Math.abs(lateHigh - earlyHigh) < earlyHigh * 0.003
  ) {
    return {
      pattern: 'triangle_ascending',
      direction: 'bullish',
      scoreBoost: 0.06,
      status: 'forming',
    };
  }

  return null;
}

function detectRangeBreakout(
  candles: FyersAPI.Candle[],
  support: number,
  resistance: number,
): ChartPatternResult | null {
  if (support <= 0 || resistance <= 0 || resistance <= support) return null;

  const window = candles.slice(-12, -1);
  if (window.length < 8) return null;

  const rangeWidth = resistance - support;
  const inside = window.filter(
    (c) => c[4] >= support * 0.999 && c[4] <= resistance * 1.001,
  ).length;

  if (inside / window.length < 0.65) return null;

  const last = candles[candles.length - 1];
  const close = last[4];

  if (close > resistance + rangeWidth * 0.05) {
    return {
      pattern: 'range_breakout_bull',
      direction: 'bullish',
      scoreBoost: 0.09,
      status: 'confirmed',
    };
  }

  if (close < support - rangeWidth * 0.05) {
    return {
      pattern: 'range_breakout_bear',
      direction: 'bearish',
      scoreBoost: -0.09,
      status: 'confirmed',
    };
  }

  return null;
}

function detectTrendlineBreak(
  candles: FyersAPI.Candle[],
  swings: Swing,
): ChartPatternResult | null {
  const highs = swings.highs.slice(-3);
  const lows = swings.lows.slice(-3);

  const lastClose = candles[candles.length - 1][4];
  const lastIdx = candles.length - 1;

  if (lows.length >= 2) {
    const l1 = lows[lows.length - 2];
    const l2 = lows[lows.length - 1];
    if (l2.index > l1.index) {
      const slope = (l2.price - l1.price) / (l2.index - l1.index);
      const projected = l2.price + slope * (lastIdx - l2.index);
      if (slope > 0 && lastClose < projected - priceTolerance(projected) * 0.5) {
        return {
          pattern: 'trendline_break_bear',
          direction: 'bearish',
          scoreBoost: -0.07,
          status: 'confirmed',
        };
      }
    }
  }

  if (highs.length >= 2) {
    const h1 = highs[highs.length - 2];
    const h2 = highs[highs.length - 1];
    if (h2.index > h1.index) {
      const slope = (h2.price - h1.price) / (h2.index - h1.index);
      const projected = h2.price + slope * (lastIdx - h2.index);
      if (slope < 0 && lastClose > projected + priceTolerance(projected) * 0.5) {
        return {
          pattern: 'trendline_break_bull',
          direction: 'bullish',
          scoreBoost: 0.07,
          status: 'confirmed',
        };
      }
    }
  }

  return null;
}

export type { ChartPatternId };