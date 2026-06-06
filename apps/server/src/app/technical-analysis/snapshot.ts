import { FastifyInstance } from 'fastify';
import { FyersAPI } from 'fyers-api-v3';
import {
  CANDLESTICK_SCORING,
  CONFLUENCE_ENHANCEMENTS,
  MTF_SCORE_WEIGHTS,
} from '../constants/technical-analysis';
import { detectChartPattern } from './chart-patterns';
import { detectCandlestickPattern } from './candlestick-patterns';
import { analyzeSessionBias } from './session-bias';
import { analyzeTrendQuality } from './trend-quality';
import { analyzeVolatilityRegime } from './volatility-regime';
import {
  PriceActionResponse,
  Timeframe,
  TimelineMomentumDecay,
  TradeSetup,
} from '../types/technical-analysis';
import { buildTradeSetup } from './timeline-utils';
import { TradingStyle } from '../types/trading-style';

export interface SnapshotDeps {
  ta: FastifyInstance['technicalAnalysisPlugin'];
  momentum: FastifyInstance['momentumDecayPlugin'];
}

export interface SnapshotInput {
  symbol: string;
  tradingStyle: TradingStyle;
  candles5m: FyersAPI.Candle[];
  candles15m: FyersAPI.Candle[];
  candles1h: FyersAPI.Candle[];
  /** Wall-clock ms for session-bias (live = now; timeline = anchor asOf) */
  asOfMs?: number;
}

const countRecentStructure = (
  items: Array<{ type: 'bullish' | 'bearish' }>,
  type: 'bullish' | 'bearish',
  lookback = 3,
) => items.slice(-lookback).filter((item) => item.type === type).length;

export function buildPriceActionSnapshot(
  deps: SnapshotDeps,
  input: SnapshotInput,
): PriceActionResponse | null {
  const { ta, momentum } = deps;
  const { symbol, tradingStyle, candles5m, candles15m, candles1h, asOfMs } =
    input;

  if (
    candles5m.length < 5 ||
    candles15m.length < 5 ||
    candles1h.length < 3
  ) {
    return null;
  }

  const swings5m = ta.getSwings(candles5m);
  const swings15m = ta.getSwings(candles15m);
  const swings1h = ta.getSwings(candles1h);

  const ms5m = ta.getMarketStructure(swings5m);
  const ms15m = ta.getMarketStructure(swings15m);
  const ms1h = ta.getMarketStructure(swings1h);

  const sr5m = ta.getSupportAndResistance(swings5m);
  const sr15m = ta.getSupportAndResistance(swings15m);
  const sr1h = ta.getSupportAndResistance(swings1h);

  const breakout5m = ta.detectBreakout(candles5m, sr5m.support, sr5m.resistance);
  const breakout15m = ta.detectBreakout(
    candles15m,
    sr15m.support,
    sr15m.resistance,
  );
  const breakout1h = ta.detectBreakout(candles1h, sr1h.support, sr1h.resistance);

  const vol5m = ta.volumeScore(candles5m);
  const vol15m = ta.volumeScore(candles15m);
  const vol1h = ta.volumeScore(candles1h);

  const trendBias5m = ta.swingTrendBias(swings5m);
  const trendBias15m = ta.swingTrendBias(swings15m);
  const trendBias1h = ta.swingTrendBias(swings1h);

  const bos5m = ta.detectBOS(candles5m, swings5m);
  const bos15m = ta.detectBOS(candles15m, swings15m);
  const bos1h = ta.detectBOS(candles1h, swings1h);

  const choch5m = ta.detectCHOCH(candles5m, swings5m, trendBias5m);
  const choch15m = ta.detectCHOCH(candles15m, swings15m, trendBias15m);
  const choch1h = ta.detectCHOCH(candles1h, swings1h, trendBias1h);

  const ls5m = ta.detectLiquiditySweep(candles5m, swings5m);
  const ls15m = ta.detectLiquiditySweep(candles15m, swings15m);
  const ls1h = ta.detectLiquiditySweep(candles1h, swings1h);

  const fvg5m = ta.detectFairValueGaps(candles5m);
  const fvg15m = ta.detectFairValueGaps(candles15m);
  const fvg1h = ta.detectFairValueGaps(candles1h);

  const ob5m = ta.detectOrderBlocks(candles5m);
  const ob15m = ta.detectOrderBlocks(candles15m);
  const ob1h = ta.detectOrderBlocks(candles1h);

  const pdhl5m = ta.getPreviousDayHighLow(candles5m);
  const pdhl15m = ta.getPreviousDayHighLow(candles15m);
  const pdhl1h = ta.getPreviousDayHighLow(candles1h);

  const atr5m = ta.calculateATR(candles5m);
  const atr15m = ta.calculateATR(candles15m);
  const atr1h = ta.calculateATR(candles1h);

  const adx5m = ta.calculateADX(candles5m);
  const adx15m = ta.calculateADX(candles15m);
  const adx1h = ta.calculateADX(candles1h);

  const fakeout5m = ta.detectFakeout(candles5m, sr5m.support, sr5m.resistance);
  const fakeout15m = ta.detectFakeout(
    candles15m,
    sr15m.support,
    sr15m.resistance,
  );
  const fakeout1h = ta.detectFakeout(candles1h, sr1h.support, sr1h.resistance);

  const recentMomentum5m = momentum.computeRecentCandleMomentum(candles5m);
  const recentMomentum15m = momentum.computeRecentCandleMomentum(candles15m);
  const recentMomentum1h = momentum.computeRecentCandleMomentum(candles1h);

  const candlestick5m = detectCandlestickPattern(candles5m);
  const candlestick15m = detectCandlestickPattern(candles15m);
  const candlestick1h = detectCandlestickPattern(candles1h);
  const candlestickBoostFor = (boost: number) =>
    tradingStyle === TradingStyle.Intraday && CANDLESTICK_SCORING.ENABLED_FOR_INTRADAY
      ? boost
      : 0;

  const enhancementsEnabled =
    tradingStyle === TradingStyle.Intraday &&
    CONFLUENCE_ENHANCEMENTS.ENABLED_FOR_INTRADAY;

  const chartPattern5m = detectChartPattern(
    candles5m,
    swings5m,
    sr5m.support,
    sr5m.resistance,
  );
  const chartPattern15m = detectChartPattern(
    candles15m,
    swings15m,
    sr15m.support,
    sr15m.resistance,
  );
  const chartPattern1h = detectChartPattern(
    candles1h,
    swings1h,
    sr1h.support,
    sr1h.resistance,
  );

  const chartBoostFor = (boost: number) =>
    enhancementsEnabled && CONFLUENCE_ENHANCEMENTS.CHART_PATTERN_SCORE_ENABLED
      ? boost
      : 0;

  const score5m = ta.scoreTimeFrameContext({
    structure: ms5m,
    breakout: breakout5m,
    retest: ta.detectRetest(candles5m, sr5m.support, sr5m.resistance),
    volume: vol5m,
    fakeout: fakeout5m,
    trendBias: trendBias5m,
    bos: bos5m,
    choch: choch5m,
    liquiditySweep: ls5m,
    fvgCount: fvg5m.length,
    obCount: ob5m.length,
    bullishFvgCount: countRecentStructure(fvg5m, 'bullish'),
    bearishFvgCount: countRecentStructure(fvg5m, 'bearish'),
    bullishObCount: countRecentStructure(ob5m, 'bullish'),
    bearishObCount: countRecentStructure(ob5m, 'bearish'),
    atr: atr5m,
    adx: adx5m,
    recentMomentum: recentMomentum5m,
    candlestickBoost: candlestickBoostFor(candlestick5m.scoreBoost),
    chartPatternBoost: chartBoostFor(chartPattern5m.scoreBoost),
  });

  const score15m = ta.scoreTimeFrameContext({
    structure: ms15m,
    breakout: breakout15m,
    retest: ta.detectRetest(candles15m, sr15m.support, sr15m.resistance),
    volume: vol15m,
    fakeout: fakeout15m,
    trendBias: trendBias15m,
    bos: bos15m,
    choch: choch15m,
    liquiditySweep: ls15m,
    fvgCount: fvg15m.length,
    obCount: ob15m.length,
    bullishFvgCount: countRecentStructure(fvg15m, 'bullish'),
    bearishFvgCount: countRecentStructure(fvg15m, 'bearish'),
    bullishObCount: countRecentStructure(ob15m, 'bullish'),
    bearishObCount: countRecentStructure(ob15m, 'bearish'),
    atr: atr15m,
    adx: adx15m,
    recentMomentum: recentMomentum15m,
    candlestickBoost: candlestickBoostFor(candlestick15m.scoreBoost),
    chartPatternBoost: chartBoostFor(chartPattern15m.scoreBoost),
  });

  const score1h = ta.scoreTimeFrameContext({
    structure: ms1h,
    breakout: breakout1h,
    retest: ta.detectRetest(candles1h, sr1h.support, sr1h.resistance),
    volume: vol1h,
    fakeout: fakeout1h,
    trendBias: trendBias1h,
    bos: bos1h,
    choch: choch1h,
    liquiditySweep: ls1h,
    fvgCount: fvg1h.length,
    obCount: ob1h.length,
    bullishFvgCount: countRecentStructure(fvg1h, 'bullish', 2),
    bearishFvgCount: countRecentStructure(fvg1h, 'bearish', 2),
    bullishObCount: countRecentStructure(ob1h, 'bullish', 2),
    bearishObCount: countRecentStructure(ob1h, 'bearish', 2),
    atr: atr1h,
    adx: adx1h,
    recentMomentum: recentMomentum1h,
    candlestickBoost: candlestickBoostFor(candlestick1h.scoreBoost),
    chartPatternBoost: chartBoostFor(chartPattern1h.scoreBoost),
  });

  let primaryCandles: FyersAPI.Candle[];
  let primarySwings: any;
  let primaryBreakout: number;
  let primaryVolume: number;
  let primarySR: { support: number; resistance: number };
  let primaryTimeframe: Timeframe;

  if (tradingStyle === TradingStyle.Scalper) {
    primaryCandles = candles5m;
    primarySwings = swings5m;
    primaryBreakout = breakout5m;
    primaryVolume = vol5m;
    primarySR = sr5m;
    primaryTimeframe = '5m';
  } else if (tradingStyle === TradingStyle.Positional) {
    primaryCandles = candles1h;
    primarySwings = swings1h;
    primaryBreakout = breakout1h;
    primaryVolume = vol1h;
    primarySR = sr1h;
    primaryTimeframe = '1h';
  } else {
    primaryCandles = candles15m;
    primarySwings = swings15m;
    primaryBreakout = breakout15m;
    primaryVolume = vol15m;
    primarySR = sr15m;
    primaryTimeframe = '15m';
  }

  const primaryLastPrice = primaryCandles[primaryCandles.length - 1][4];
  const chartPatternPrimary =
    primaryTimeframe === '5m'
      ? chartPattern5m
      : primaryTimeframe === '15m'
        ? chartPattern15m
        : chartPattern1h;

  const volatilityRegime = analyzeVolatilityRegime(
    tradingStyle === TradingStyle.Scalper ? candles5m : candles15m,
  );
  const sessionBias = analyzeSessionBias(
    asOfMs ?? primaryCandles[primaryCandles.length - 1][0] * 1000,
    score15m,
    score1h,
  );
  const trendQuality = analyzeTrendQuality({
    candles: candles15m,
    marketStructure: ms15m,
    adx15m,
    atr15m,
  });

  const candlestickPrimary =
    primaryTimeframe === '5m'
      ? candlestick5m
      : primaryTimeframe === '15m'
        ? candlestick15m
        : candlestick1h;

  const atrCompression = ta.computeRangeCompression(primaryCandles);
  const primaryAtr =
    primaryTimeframe === '5m'
      ? atr5m
      : primaryTimeframe === '15m'
        ? atr15m
        : atr1h;

  const confluentSignal = ta.getConfluentTradeSignal({
    tradingStyle,
    scores: { score5m, score15m, score1h },
    structures: { ms5m, ms15m, ms1h },
    primary: {
      lastPrice: primaryLastPrice,
      swings: primarySwings,
      volume: primaryVolume,
      breakout: primaryBreakout,
      support: primarySR.support,
      resistance: primarySR.resistance,
    },
    momentum: {
      fakeout15m,
      adx5m,
      adx15m,
      adx1h,
      recentMomentum5m,
      recentMomentum15m,
      atrCompression,
      primaryAtr,
      candlestickPrimary,
      candlestick15m,
      chartPatternPrimary,
      volatilityRegime,
      sessionBias,
      trendQuality,
      structureElements: {
        fvg: {
          '5m': fvg5m.slice(-3),
          '15m': fvg15m.slice(-3),
          '1h': fvg1h.slice(-2),
        },
        orderBlocks: {
          '5m': ob5m,
          '15m': ob15m,
          '1h': ob1h,
        },
      },
    },
  });

  const mtfScore =
    MTF_SCORE_WEIGHTS['5m'] * score5m +
    MTF_SCORE_WEIGHTS['15m'] * score15m +
    MTF_SCORE_WEIGHTS['1h'] * score1h;

  const primarySign = Math.sign(
    confluentSignal.action === 'CE-BUY'
      ? 1
      : confluentSignal.action === 'PE-BUY'
        ? -1
        : 0,
  );
  let alignedCount = 0;
  if (primarySign !== 0) {
    if (Math.sign(score5m) === primarySign) alignedCount++;
    if (Math.sign(score15m) === primarySign) alignedCount++;
    if (Math.sign(score1h) === primarySign) alignedCount++;
  }

  const higherTFConfirmation =
    (confluentSignal.action === 'CE-BUY' && (ms1h === 1 || score1h > 0.1)) ||
    (confluentSignal.action === 'PE-BUY' && (ms1h === -1 || score1h < -0.1));

  const tradeSetup: TradeSetup | undefined = buildTradeSetup(
    confluentSignal.action,
    confluentSignal.entry,
    confluentSignal.stopLoss,
    primaryAtr,
  );

  const momentumDecay: TimelineMomentumDecay | undefined =
    confluentSignal.momentumDecay &&
    confluentSignal.confidenceBeforeDecay !== undefined
      ? {
          decayPercent: +(
            confluentSignal.momentumDecay.decayPercent * 100
          ).toFixed(1),
          reasons: confluentSignal.momentumDecay.reasons,
          confidenceBefore: confluentSignal.confidenceBeforeDecay,
          confidenceAfter: confluentSignal.vetoedByDecay
            ? 0
            : confluentSignal.confidence,
          minConfidenceRequired: confluentSignal.minConfidenceAfterDecay,
          structuralAction: confluentSignal.structuralAction,
          vetoedByDecay: confluentSignal.vetoedByDecay,
        }
      : undefined;

  return {
    symbol,
    lastPrice: primaryLastPrice,
    tradingStyle,
    primaryTimeframe,
    signal: {
      action: confluentSignal.action,
      confidence: confluentSignal.confidence,
      strength: confluentSignal.strength,
      vetoReason: confluentSignal.entryVetoReason,
      structuralAction: confluentSignal.structuralAction,
    },
    candlestick: {
      primary: candlestickPrimary.pattern,
      '5m': candlestick5m.pattern,
      '15m': candlestick15m.pattern,
      '1h': candlestick1h.pattern,
    },
    tradeSetup,
    momentumDecay,
    confluence: {
      mtfScore: +mtfScore.toFixed(3),
      aligned: alignedCount,
      total: 3,
      higherTimeframeConfirmation: higherTFConfirmation,
      summary:
        confluentSignal.action === 'NO-TRADE'
          ? 'No clear confluence. Wait for better alignment across timeframes.'
          : `${alignedCount}/3 timeframes aligned. ${higherTFConfirmation ? 'Higher TF supportive.' : 'Higher TF mixed/neutral.'}`,
    },
    levels: {
      support: +(primarySR.support || 0).toFixed(2),
      resistance: +(primarySR.resistance || 0).toFixed(2),
    },
    timeframeScores: {
      '5m': +score5m.toFixed(3),
      '15m': +score15m.toFixed(3),
      '1h': +score1h.toFixed(3),
    },
    atr: {
      '5m': +atr5m.toFixed(2),
      '15m': +atr15m.toFixed(2),
      '1h': +atr1h.toFixed(2),
    },
    adx: {
      '5m': +adx5m.toFixed(1),
      '15m': +adx15m.toFixed(1),
      '1h': +adx1h.toFixed(1),
    },
    structureElements: {
      fvg: {
        '5m': fvg5m.slice(-3),
        '15m': fvg15m.slice(-3),
        '1h': fvg1h.slice(-2),
      },
      orderBlocks: {
        '5m': ob5m,
        '15m': ob15m,
        '1h': ob1h,
      },
      previousDayHL: {
        '5m': pdhl5m,
        '15m': pdhl15m,
        '1h': pdhl1h,
      },
    },
    momentum: {
      recent: {
        '5m': +recentMomentum5m.toFixed(3),
        '15m': +recentMomentum15m.toFixed(3),
        '1h': +recentMomentum1h.toFixed(3),
      },
      fakeout: {
        '5m': fakeout5m,
        '15m': fakeout15m,
        '1h': fakeout1h,
      },
    },
    confluenceContext: enhancementsEnabled
      ? {
          chartPattern: chartPatternPrimary.pattern,
          volatility: volatilityRegime,
          session: sessionBias,
          trendQuality,
        }
      : undefined,
  };
}