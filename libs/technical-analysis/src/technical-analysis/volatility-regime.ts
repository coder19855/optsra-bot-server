import { FyersAPI } from 'fyers-api-v3';
import { ATR } from 'technicalindicators';
import { TIMELINE_DEFAULTS } from '../constants/technical-analysis';
import { VolatilityRegime } from '../types/technical-analysis';

const IST = TIMELINE_DEFAULTS.IST_TIMEZONE;

function getIstDayKey(epochSec: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: IST,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(epochSec * 1000));
}

function computeAtrSeries(
  candles: FyersAPI.Candle[],
  period = 14,
): number[] {
  if (candles.length < period + 2) return [];

  const high = candles.map((c) => c[2]);
  const low = candles.map((c) => c[3]);
  const close = candles.map((c) => c[4]);

  return ATR.calculate({ period, high, low, close });
}

function percentileRank(value: number, series: number[]): number {
  if (series.length === 0) return 50;
  const sorted = [...series].sort((a, b) => a - b);
  const below = sorted.filter((v) => v <= value).length;
  return Math.round((below / sorted.length) * 100);
}

function sessionRangesByDay(candles: FyersAPI.Candle[]): Map<string, number> {
  const map = new Map<string, { high: number; low: number }>();

  for (const c of candles) {
    const key = getIstDayKey(c[0]);
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { high: c[2], low: c[3] });
    } else {
      prev.high = Math.max(prev.high, c[2]);
      prev.low = Math.min(prev.low, c[3]);
    }
  }

  const ranges = new Map<string, number>();
  for (const [key, { high, low }] of map) {
    ranges.set(key, high - low);
  }
  return ranges;
}

/** ATR trend, 20-day percentile, and session compression/expansion. */
export function analyzeVolatilityRegime(
  candles: FyersAPI.Candle[],
): VolatilityRegime {
  const defaultRegime: VolatilityRegime = {
    atrTrend: 'flat',
    atrPercentile: 50,
    sessionPhase: 'normal',
    isDeadMarket: false,
  };

  if (candles.length < 30) return defaultRegime;

  const atrSeries = computeAtrSeries(candles);
  if (atrSeries.length < 6) return defaultRegime;

  const currentAtr = atrSeries[atrSeries.length - 1];
  const priorAtr = atrSeries[atrSeries.length - 6];
  const changePct = priorAtr > 0 ? (currentAtr - priorAtr) / priorAtr : 0;

  let atrTrend: VolatilityRegime['atrTrend'] = 'flat';
  if (changePct > 0.08) atrTrend = 'rising';
  else if (changePct < -0.08) atrTrend = 'falling';

  const lookback = atrSeries.slice(-Math.min(atrSeries.length, 520));
  const atrPercentile = percentileRank(currentAtr, lookback);

  const dayRanges = sessionRangesByDay(candles);
  const keys = [...dayRanges.keys()].sort();
  if (keys.length < 2) {
    return { ...defaultRegime, atrTrend, atrPercentile };
  }

  const todayKey = keys[keys.length - 1];
  const todayRange = dayRanges.get(todayKey) ?? 0;
  const priorRanges = keys.slice(-6, -1).map((k) => dayRanges.get(k) ?? 0);
  const avgPrior =
    priorRanges.reduce((a, b) => a + b, 0) / Math.max(1, priorRanges.length);

  let sessionPhase: VolatilityRegime['sessionPhase'] = 'normal';
  if (avgPrior > 0) {
    const ratio = todayRange / avgPrior;
    if (ratio < 0.65) sessionPhase = 'compression';
    else if (ratio > 1.25) sessionPhase = 'expansion';
  }

  const isDeadMarket =
    atrPercentile < 20 &&
    sessionPhase === 'compression' &&
    atrTrend === 'falling';

  return {
    atrTrend,
    atrPercentile,
    sessionPhase,
    isDeadMarket,
  };
}