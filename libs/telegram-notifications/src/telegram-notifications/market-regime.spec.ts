import { TradingStyle } from '../types/trading-style';
import {
  buildDeckRegimeHint,
  resetMarketRegimeStore,
  resolveDeckMarketRegime,
} from './market-regime';

const SYMBOL = 'NSE:NIFTY50-INDEX';

function trendingContext() {
  return {
    trendQuality: {
      bullish: 0.72,
      bearish: 0.2,
      label: 'strong' as const,
      components: {
        adx: 0.8,
        slope15m: 0.7,
        structure: 0.75,
        emaDistance: 0.6,
      },
    },
    session: {
      phase: 'morning' as const,
      directionalBias: 0.3,
      confluenceMultiplier: 0.95,
      label: 'Morning',
    },
    volatility: {
      atrTrend: 'rising' as const,
      atrPercentile: 55,
      sessionPhase: 'normal' as const,
      isDeadMarket: false,
    },
    chartPattern: 'none' as const,
  };
}

function sidewaysContext() {
  return {
    trendQuality: {
      bullish: 0.28,
      bearish: 0.25,
      label: 'choppy' as const,
      components: {
        adx: 0.2,
        slope15m: 0.15,
        structure: 0.2,
        emaDistance: 0.55,
      },
    },
    session: {
      phase: 'midday' as const,
      directionalBias: 0,
      confluenceMultiplier: 1.15,
      label: 'Midday chop',
    },
    volatility: {
      atrTrend: 'flat' as const,
      atrPercentile: 22,
      sessionPhase: 'compression' as const,
      isDeadMarket: true,
    },
    chartPattern: 'none' as const,
  };
}

describe('buildDeckRegimeHint', () => {
  it('shows blend weights and relaxed veto instead of PA-led copy', () => {
    expect(
      buildDeckRegimeHint({
        regimeKind: 'trending',
        flowMode: 'blend',
        vetoMode: 'relaxed',
        tradingStyle: TradingStyle.Intraday,
      }),
    ).toBe('Blend 65/35 · relaxed veto · directional tape');
  });

  it('shows PA-only when flow mode is pa-only', () => {
    expect(
      buildDeckRegimeHint({
        regimeKind: 'sideways',
        flowMode: 'pa-only',
        vetoMode: 'strict',
        tradingStyle: TradingStyle.Intraday,
      }),
    ).toBe('PA-only · strict veto · range-bound tape');
  });
});

describe('resolveDeckMarketRegime', () => {
  beforeEach(() => {
    resetMarketRegimeStore();
  });

  it('labels strong aligned tape as trending up', () => {
    const regime = resolveDeckMarketRegime({
      symbol: SYMBOL,
      tradingStyle: TradingStyle.Intraday,
      mtfScore: 0.35,
      aligned: 3,
      confluenceContext: trendingContext(),
    });

    expect(regime.kind).toBe('trending');
    expect(regime.direction).toBe('up');
    expect(regime.arrow).toBe('↑');
    expect(regime.label).toBe('Trending up');
  });

  it('labels choppy midday tape as sideways', () => {
    const regime = resolveDeckMarketRegime({
      symbol: SYMBOL,
      tradingStyle: TradingStyle.Intraday,
      mtfScore: 0.05,
      aligned: 1,
      confluenceContext: sidewaysContext(),
    });

    expect(regime.kind).toBe('sideways');
    expect(regime.arrow).toBe('↔');
    expect(regime.label).toBe('Sideways');
    expect(regime.suggestedPaWeight).toBe(0.5);
  });

  it('requires multiple polls before leaving trending for sideways', () => {
    const base = {
      symbol: SYMBOL,
      tradingStyle: TradingStyle.Intraday,
      mtfScore: 0.35,
      aligned: 3,
      confluenceContext: trendingContext(),
    };
    resolveDeckMarketRegime(base);

    const chopInput = {
      symbol: SYMBOL,
      tradingStyle: TradingStyle.Intraday,
      mtfScore: 0.04,
      aligned: 1,
      confluenceContext: sidewaysContext(),
    };

    const first = resolveDeckMarketRegime(chopInput);
    expect(first.kind).toBe('trending');
    expect(first.confirming).toBe(true);
    expect(first.rawKind).toBe('sideways');

    resolveDeckMarketRegime(chopInput);
    const third = resolveDeckMarketRegime(chopInput);
    expect(third.kind).toBe('sideways');
    expect(third.confirming).toBe(false);
  });
});