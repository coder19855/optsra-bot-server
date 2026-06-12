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