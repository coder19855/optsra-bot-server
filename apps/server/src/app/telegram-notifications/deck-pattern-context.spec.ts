import {
  buildDeckPatternContext,
  buildIstChartSession,
} from './deck-pattern-context';
import { samplePriceAction } from '../testing/fixtures';

describe('deck-pattern-context', () => {
  it('builds IST session bounds for intraday chart zoom', () => {
    const anchor = new Date('2026-06-12T11:30:00+05:30').getTime();
    const session = buildIstChartSession(anchor);
    expect(session.label).toBe('09:15–15:30 IST');
    expect(session.toMs).toBe(anchor);
    expect(session.fromMs).toBeLessThan(session.toMs);
    expect(session.closeMs).toBeGreaterThan(session.toMs);
  });

  it('builds label, markers, overlays, and session', () => {
    const ctx = buildDeckPatternContext(
      samplePriceAction({
        levels: { support: 24920, resistance: 25110 },
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
          chartPatternNeckline: 25040,
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
      1_700_000_000_000,
    );

    expect(ctx.label).toContain('bullish engulfing');
    expect(ctx.label).toContain('forming double bottom');
    expect(ctx.markers).toHaveLength(2);
    expect(ctx.overlays.some((o) => o.kind === 'support')).toBe(true);
    expect(ctx.overlays.some((o) => o.kind === 'resistance')).toBe(true);
    expect(ctx.overlays.some((o) => o.kind === 'neckline')).toBe(true);
    expect(ctx.session.label).toBe('09:15–15:30 IST');
  });
});