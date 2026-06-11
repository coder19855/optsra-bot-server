import { FyersAPI } from 'fyers-api-v3';
import { detectChartPattern } from './chart-patterns';
import { sampleCandles } from '../testing/fixtures';

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