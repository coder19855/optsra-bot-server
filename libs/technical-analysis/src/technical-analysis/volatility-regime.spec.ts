import { analyzeVolatilityRegime } from './volatility-regime';
import { sampleCandles } from '../testing/fixtures';

describe('analyzeVolatilityRegime', () => {
  it('classifies volatility from candle history', () => {
    const candles = sampleCandles(60, 25000);
    const regime = analyzeVolatilityRegime(candles);
    expect(['compression', 'normal', 'expansion']).toContain(regime.sessionPhase);
    expect(regime.atrPercentile).toBeGreaterThanOrEqual(0);
    expect(regime.atrPercentile).toBeLessThanOrEqual(100);
  });

  it('returns normal regime for insufficient history', () => {
    const regime = analyzeVolatilityRegime(sampleCandles(5));
    expect(regime.sessionPhase).toBe('normal');
  });
});