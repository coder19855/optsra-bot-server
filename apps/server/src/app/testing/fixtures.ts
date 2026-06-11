import { FyersAPI } from 'fyers-api-v3';
import { OptionMetricsResponse } from '../types';
import { PriceActionResponse } from '../types/technical-analysis';

export function sampleOptionChain(atm = 25000): FyersAPI.OptionChainData[] {
  const strikes = [atm - 100, atm, atm + 100];
  const rows: FyersAPI.OptionChainData[] = [];
  for (const strike of strikes) {
    rows.push({
      strike_price: strike,
      option_type: 'CE',
      ltp: 120,
      oi: strike === atm ? 50000 : 20000,
      oich: strike === atm ? 5000 : 1000,
      volume: 1000,
      delta: 0.45,
      gamma: 0.02,
      theta: -5,
      vega: 10,
    } as unknown as FyersAPI.OptionChainData);
    rows.push({
      strike_price: strike,
      option_type: 'PE',
      ltp: 110,
      oi: strike === atm ? 48000 : 22000,
      oich: strike === atm ? 4500 : 1200,
      volume: 900,
      delta: -0.42,
      gamma: 0.02,
      theta: -4,
      vega: 9,
    } as unknown as FyersAPI.OptionChainData);
  }
  return rows;
}

export function samplePriceAction(
  overrides: Partial<PriceActionResponse> = {},
): PriceActionResponse {
  return {
    symbol: 'NSE:NIFTY50-INDEX',
    lastPrice: 25000,
    primaryTimeframe: '15m',
    timeframeScores: { '5m': -0.1, '15m': -0.22, '1h': -0.15 },
    signal: {
      action: 'PE-BUY',
      confidence: 58,
      strength: 'moderate',
    },
    levels: { support: 24900, resistance: 25100 },
    structureElements: { fvg: {}, orderBlocks: {} },
    atr: { '5m': 20, '15m': 35, '1h': 50 },
    adx: { '5m': 22, '15m': 24, '1h': 18 },
    momentum: {},
    tradeSetup: null,
    confluence: {
      mtfScore: -0.18,
      aligned: 2,
      total: 3,
      higherTimeframeConfirmation: false,
      summary: 'Bearish alignment on primary 15m',
    },
    ...overrides,
  } as PriceActionResponse;
}

export function sampleOptionMetrics(
  overrides: Partial<OptionMetricsResponse> = {},
): OptionMetricsResponse {
  return {
    spotSymbol: 'NSE:NIFTY50-INDEX',
    spotLtp: 25000,
    spotLtpChangePercent: -0.2,
    score: -35,
    signal: 'BEARISH_TRADE',
    bias: 'Bearish',
    ivRegime: 'Normal IV',
    components: {
      oi: -0.2,
      greeks: -0.15,
      iv: 0,
      trend: -0.1,
      pcr: -0.1,
      skew: -0.05,
      pain: 0,
      vix: 0,
    },
    strategies: [],
    optionChainNearby: [],
    explanations: {
      oi: { name: 'OI', score: -0.2, interpretation: 'Bearish', weightage: 15 },
      iv: { name: 'IV', score: 0, interpretation: 'Neutral', weightage: 10 },
      greeks: {
        name: 'Greeks',
        score: -0.15,
        interpretation: 'Bearish',
        weightage: 20,
      },
    },
    ...overrides,
  } as OptionMetricsResponse;
}

/** Minimal OHLCV candles: [ts, open, high, low, close, volume] */
export function sampleCandles(count = 40, startPrice = 25000): FyersAPI.Candle[] {
  const candles: FyersAPI.Candle[] = [];
  let price = startPrice;
  for (let i = 0; i < count; i += 1) {
    const open = price;
    const close = price + (i % 3 === 0 ? -8 : 5);
    const high = Math.max(open, close) + 4;
    const low = Math.min(open, close) - 4;
    candles.push([1_700_000_000 + i * 300, open, high, low, close, 1000]);
    price = close;
  }
  return candles;
}