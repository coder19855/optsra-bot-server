import { FyersAPI } from 'fyers-api-v3';
import { TrendQuality } from '../types/technical-analysis';

function ema(values: number[], period: number): number {
  if (values.length === 0) return 0;
  const k = 2 / (period + 1);
  let result = values[0];
  for (let i = 1; i < values.length; i++) {
    result = values[i] * k + result * (1 - k);
  }
  return result;
}

function linearSlope(values: number[]): number {
  const n = values.length;
  if (n < 3) return 0;

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;

  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += values[i];
    sumXY += i * values[i];
    sumXX += i * i;
  }

  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function qualityLabel(score: number): TrendQuality['label'] {
  if (score >= 0.68) return 'strong';
  if (score >= 0.48) return 'moderate';
  if (score >= 0.32) return 'weak';
  return 'choppy';
}

/** Combines ADX, 15m slope, HH/HL structure, and distance from 20EMA. */
export function analyzeTrendQuality(params: {
  candles: FyersAPI.Candle[];
  marketStructure: number;
  adx15m: number;
  atr15m: number;
}): TrendQuality {
  const { candles, marketStructure, adx15m, atr15m } = params;

  const adxNorm = clamp01(adx15m / 30);

  const closes = candles.slice(-12).map((c) => c[4]);
  const slope = linearSlope(closes);
  const slopeNorm = clamp01(Math.abs(slope) / Math.max(atr15m * 0.15, 1));

  const structureBull = marketStructure === 1 ? 1 : marketStructure === 0 ? 0.35 : 0.1;
  const structureBear = marketStructure === -1 ? 1 : marketStructure === 0 ? 0.35 : 0.1;

  const ema20 = ema(candles.slice(-30).map((c) => c[4]), 20);
  const lastClose = candles[candles.length - 1][4];
  const distAtr =
    atr15m > 0 ? Math.abs(lastClose - ema20) / atr15m : 0;

  let emaNorm = 1;
  if (distAtr < 0.2) emaNorm = 0.55;
  else if (distAtr > 2.5) emaNorm = 0.45;
  else if (distAtr >= 0.4 && distAtr <= 1.5) emaNorm = 1;

  const slopeBull = slope > 0 ? slopeNorm : slopeNorm * 0.25;
  const slopeBear = slope < 0 ? slopeNorm : slopeNorm * 0.25;

  const bullish = clamp01(
    adxNorm * 0.3 + slopeBull * 0.25 + structureBull * 0.25 + emaNorm * 0.2,
  );
  const bearish = clamp01(
    adxNorm * 0.3 + slopeBear * 0.25 + structureBear * 0.25 + emaNorm * 0.2,
  );

  const dominant = Math.max(bullish, bearish);

  return {
    bullish: +bullish.toFixed(3),
    bearish: +bearish.toFixed(3),
    components: {
      adx: +adxNorm.toFixed(3),
      slope15m: +slopeNorm.toFixed(3),
      structure: +Math.max(structureBull, structureBear).toFixed(3),
      emaDistance: +emaNorm.toFixed(3),
    },
    label: qualityLabel(dominant),
  };
}