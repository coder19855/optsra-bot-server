import { FyersAPI } from 'fyers-api-v3';
import { detectCandlestickPattern } from './candlestick-patterns';

function candle(
  open: number,
  close: number,
  high?: number,
  low?: number,
): FyersAPI.Candle {
  return [1_700_000_000, open, high ?? Math.max(open, close) + 2, low ?? Math.min(open, close) - 2, close, 1000];
}

describe('detectCandlestickPattern', () => {
  it('detects bullish engulfing', () => {
    const result = detectCandlestickPattern([
      candle(102, 100, 103, 99),
      candle(99, 103, 104, 98),
    ]);
    expect(result.pattern).toBe('bullish_engulfing');
    expect(result.direction).toBe('bullish');
  });

  it('detects morning star', () => {
    const result = detectCandlestickPattern([
      candle(105, 100, 106, 99),
      candle(101, 101.5, 102, 100.5),
      candle(101, 104, 105, 100),
    ]);
    expect(result.pattern).toBe('morning_star');
    expect(result.direction).toBe('bullish');
  });

  it('detects three white soldiers', () => {
    const result = detectCandlestickPattern([
      candle(100, 101, 102, 99),
      candle(101, 102.5, 103, 100.5),
      candle(102.2, 104, 105, 102),
    ]);
    expect(result.pattern).toBe('three_white_soldiers');
  });

  it('detects hammer after downtrend', () => {
    const candles = [
      candle(110, 108),
      candle(108, 106),
      candle(106, 104),
      candle(104, 102),
      candle(105, 100),
      [1_700_000_000, 99, 100, 93, 99.8, 1000],
    ];
    const result = detectCandlestickPattern(candles);
    expect(result.pattern).toBe('hammer');
    expect(result.direction).toBe('bullish');
  });
});