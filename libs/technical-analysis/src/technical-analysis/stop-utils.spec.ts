import { normalizeStopLoss } from './stop-utils';

describe('normalizeStopLoss', () => {
  const atr = 20;

  it('returns unchanged for NO-TRADE', () => {
    expect(normalizeStopLoss('NO-TRADE', 25000, 24950, atr)).toEqual({
      stopLoss: 24950,
      adjusted: false,
    });
  });

  it('widens tight CE-BUY stop to minimum ATR multiple', () => {
    const result = normalizeStopLoss('CE-BUY', 25000, 24994, atr);
    expect(result.adjusted).toBe(true);
    expect(result.stopLoss).toBeLessThan(24994);
    expect(result.reason).toContain('Widened');
  });

  it('tightens wide CE-BUY stop to maximum ATR multiple', () => {
    const result = normalizeStopLoss('CE-BUY', 25000, 24800, atr);
    expect(result.adjusted).toBe(true);
    expect(result.stopLoss).toBeGreaterThan(24800);
    expect(result.reason).toContain('Tightened');
  });

  it('widens tight PE-BUY stop', () => {
    const result = normalizeStopLoss('PE-BUY', 25000, 25006, atr);
    expect(result.adjusted).toBe(true);
    expect(result.stopLoss).toBeGreaterThan(25006);
  });

  it('keeps stop within ATR band unchanged', () => {
    const result = normalizeStopLoss('CE-BUY', 25000, 24970, atr);
    expect(result).toEqual({ stopLoss: 24970, adjusted: false });
  });
});