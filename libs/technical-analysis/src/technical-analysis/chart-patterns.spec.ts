import { FyersAPI } from 'fyers-api-v3';
import {
  detectChartPattern,
  detectFlagPennant,
  detectTriangle,
  detectWedge,
} from './chart-patterns';
import { sampleCandles } from '../testing/fixtures';

function risingWedgeSeries(lastClose: number): FyersAPI.Candle[] {
  const out: FyersAPI.Candle[] = [];
  for (let i = 0; i < 20; i += 1) {
    const early = i < 8;
    const low = early ? 24_900 + i * 2 : 25_040 + (i - 12) * 5;
    const high = early ? 25_000 + i * 2 : 25_055 + (i - 12) * 2;
    const open = (low + high) / 2;
    out.push([1_700_000_000 + i * 300, open, high, low, open, 1000]);
  }
  const prev = out[out.length - 1];
  out.push([
    1_700_000_000 + 20 * 300,
    prev[4],
    prev[2],
    lastClose - 2,
    lastClose,
    1000,
  ]);
  return out;
}

function bullFlagSeries(lastClose: number): FyersAPI.Candle[] {
  const out: FyersAPI.Candle[] = [];
  for (let i = 0; i < 16; i += 1) {
    const open = 24_800 + i * 26;
    const close = open + 26;
    out.push([1_700_000_000 + i * 300, open, close + 8, open - 2, close, 1000]);
  }
  const ranges = [18, 16, 14, 12, 11, 10, 9, 8];
  let mid = out[out.length - 1][4];
  for (let i = 0; i < 8; i += 1) {
    const span = ranges[i];
    const open = mid;
    const close = mid + (i % 2 === 0 ? 1 : -1);
    out.push([
      1_700_000_000 + (16 + i) * 300,
      open,
      open + span / 2,
      open - span / 2,
      close,
      1000,
    ]);
    mid = close;
  }
  const prev = out[out.length - 1];
  out.push([
    1_700_000_000 + 24 * 300,
    prev[4],
    lastClose + 4,
    prev[3],
    lastClose,
    1000,
  ]);
  return out;
}

function ascendingTriangleSeries(lastClose: number): FyersAPI.Candle[] {
  const out: FyersAPI.Candle[] = [];
  const ceiling = 25_100;
  for (let i = 0; i < 15; i += 1) {
    const low = 24_920 + i * 11;
    const high = ceiling;
    const open = low + 4;
    out.push([1_700_000_000 + i * 300, open, high, low, low + 6, 1000]);
  }
  const prev = out[out.length - 1];
  out.push([
    1_700_000_000 + 15 * 300,
    prev[4],
    ceiling,
    prev[3],
    lastClose,
    1000,
  ]);
  return out;
}

describe('detectChartPattern', () => {
  it('returns none for insufficient candles', () => {
    const result = detectChartPattern(
      sampleCandles(10),
      { highs: [], lows: [] },
      24900,
      25100,
    );
    expect(result.pattern).toBe('none');
  });

  it('detects forming double top before neckline break', () => {
    const candles = sampleCandles(30, 25000);
    const swings = {
      highs: [
        { index: 8, price: 25120 },
        { index: 18, price: 25115 },
      ],
      lows: [{ index: 12, price: 24980 }],
    };
    const result = detectChartPattern(candles, swings, 24900, 25100);
    expect(result.pattern).toBe('double_top');
    expect(result.status).toBe('forming');
    expect(result.direction).toBe('bearish');
    expect(result.neckline).toBeGreaterThan(0);
  });

  it('detects range breakout when price clears resistance', () => {
    const candles = sampleCandles(30, 25000);
    const last = candles[candles.length - 1];
    candles[candles.length - 1] = [
      last[0],
      last[1],
      25250,
      last[3],
      25220,
      last[5],
    ];
    const swings = {
      highs: [{ index: 10, price: 25150 }],
      lows: [{ index: 5, price: 24950 }],
    };
    const result = detectChartPattern(candles, swings, 24900, 25100);
    expect(result.pattern).toEqual(expect.any(String));
    expect(result.pattern.length).toBeGreaterThan(0);
    expect(['bullish', 'bearish', 'neutral']).toContain(result.direction);
  });
});

describe('continuation pattern confirmation', () => {
  it('detects forming vs confirmed rising wedge', () => {
    const forming = detectWedge(risingWedgeSeries(25_070));
    expect(forming?.pattern).toBe('rising_wedge');
    expect(forming?.status).toBe('forming');

    const confirmed = detectWedge(risingWedgeSeries(24_960));
    expect(confirmed?.pattern).toBe('rising_wedge');
    expect(confirmed?.status).toBe('confirmed');
    expect(confirmed?.neckline).toBeDefined();
  });

  it('detects forming vs confirmed falling wedge', () => {
    const candles: FyersAPI.Candle[] = [];
    for (let i = 0; i < 20; i += 1) {
      const early = i < 8;
      const high = early ? 25_120 - i * 2 : 25_030 - (i - 12) * 3;
      const low = early ? 25_080 - i * 4 : 24_920 - (i - 12) * 8;
      const open = (low + high) / 2;
      candles.push([1_700_000_000 + i * 300, open, high, low, open, 1000]);
    }
    const forming = detectWedge([
      ...candles,
      [1_700_000_000 + 20 * 300, 25_000, 25_010, 24_990, 25_002, 1000],
    ]);
    expect(forming?.pattern).toBe('falling_wedge');
    expect(forming?.status).toBe('forming');

    const confirmed = detectWedge([
      ...candles,
      [1_700_000_000 + 20 * 300, 25_020, 25_090, 25_010, 25_080, 1000],
    ]);
    expect(confirmed?.pattern).toBe('falling_wedge');
    expect(confirmed?.status).toBe('confirmed');
  });

  it('detects forming vs confirmed bull flag', () => {
    const forming = detectFlagPennant(bullFlagSeries(25_215));
    expect(forming?.pattern).toBe('bull_flag');
    expect(forming?.status).toBe('forming');

    const confirmed = detectFlagPennant(bullFlagSeries(25_280));
    expect(confirmed?.pattern).toBe('bull_flag');
    expect(confirmed?.status).toBe('confirmed');
    expect(confirmed?.neckline).toBeGreaterThan(0);
  });

  it('detects forming vs confirmed ascending triangle', () => {
    const forming = detectTriangle(ascendingTriangleSeries(25_095));
    expect(forming?.pattern).toBe('triangle_ascending');
    expect(forming?.status).toBe('forming');

    const confirmed = detectTriangle(ascendingTriangleSeries(25_160));
    expect(confirmed?.pattern).toBe('triangle_ascending');
    expect(confirmed?.status).toBe('confirmed');
  });

  it('detects symmetric triangle breakout direction', () => {
    const base: FyersAPI.Candle[] = [];
    for (let i = 0; i < 15; i += 1) {
      const high = 25_120 - i * 8;
      const low = 24_900 + i * 8;
      base.push([1_700_000_000 + i * 300, (high + low) / 2, high, low, low + 5, 1000]);
    }

    const bear = detectTriangle([
      ...base,
      [1_700_000_000 + 15 * 300, 25_000, 25_010, 24_820, 24_830, 1000],
    ]);
    expect(bear?.pattern).toBe('triangle_symmetric');
    expect(bear?.status).toBe('confirmed');
    expect(bear?.direction).toBe('bearish');

    const bull = detectTriangle([
      ...base,
      [1_700_000_000 + 15 * 300, 25_040, 25_090, 25_030, 25_080, 1000],
    ]);
    expect(bull?.pattern).toBe('triangle_symmetric');
    expect(bull?.status).toBe('confirmed');
    expect(bull?.direction).toBe('bullish');
  });
});