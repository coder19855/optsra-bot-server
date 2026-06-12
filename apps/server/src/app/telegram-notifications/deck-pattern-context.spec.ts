import { buildDeckPatternContext } from './deck-pattern-context';
import { samplePriceAction } from '../testing/fixtures';

describe('buildDeckPatternContext', () => {
  it('builds label and markers from candlestick and chart pattern', () => {
    const ctx = buildDeckPatternContext(
      samplePriceAction({
        candlestick: {
          primary: 'bullish_engulfing',
          '5m': 'none',
          '15m': 'bullish_engulfing',
          '1h': 'none',
        },
        confluenceContext: {
          chartPattern: 'double_bottom',
          chartPatternStatus: 'forming',
          chartPatternDirection: 'bullish',
          candlestickPrimary: 'bullish_engulfing',
          volatility: {
            atrTrend: 'flat',
            atrPercentile: 50,
            sessionPhase: 'normal',
            isDeadMarket: false,
          },
          session: {
            phase: 'morning',
            directionalBias: 0.1,
            confluenceMultiplier: 1,
            label: 'Morning trend window',
          },
          trendQuality: {
            bullish: 0.5,
            bearish: 0.3,
            components: { adx: 0.5, slope15m: 0.4, structure: 0.5, emaDistance: 0.4 },
            label: 'moderate',
          },
        },
      }),
      [{ t: 1_700_000_000_000, v: 25000 }],
    );

    expect(ctx?.label).toContain('bullish engulfing');
    expect(ctx?.label).toContain('forming double bottom');
    expect(ctx?.markers).toHaveLength(2);
  });
});