import { FastifyInstance } from 'fastify';
import { HttpStatusCode } from 'axios';
import { FyersAPI } from 'fyers-api-v3';
import {
  CANDLESTICK_SCORING,
  CONFLUENCE_ENHANCEMENTS,
  HISTORY_LOOKBACK_DAYS,
  MTF_SCORE_WEIGHTS,
} from '../constants/technical-analysis';
import { detectChartPattern } from '../technical-analysis/chart-patterns';
import { detectCandlestickPattern } from '../technical-analysis/candlestick-patterns';
import { analyzeSessionBias } from '../technical-analysis/session-bias';
import { analyzeTrendQuality } from '../technical-analysis/trend-quality';
import { analyzeVolatilityRegime } from '../technical-analysis/volatility-regime';
import {
  countAlignedTimeframes,
  isHigherTfSupportive,
} from '../technical-analysis/timeframe-alignment';
import { ResponseStatus } from '../types';
import { parseVetoModeQuery } from '../telegram-notifications/veto-preference';
import { TradingStyle } from '../trading-style';

export default async function technicalAnalysisRoute(fastify: FastifyInstance) {
  fastify.get('/api/technical-analysis', async (request, reply) => {
    try {
      const {
        symbol,
        range_to,
        tradingStyle: styleQuery,
        vetoOff: vetoOffQuery,
        vetoMode: vetoModeQuery,
        skipVeto: skipVetoQuery,
      } = request.query as FyersAPI.HistoryQueryRequest & {
        tradingStyle?: string;
        vetoOff?: string;
        vetoMode?: string;
        skipVeto?: string;
      };

      const entryVetoMode = parseVetoModeQuery(
        vetoModeQuery,
        vetoOffQuery ?? skipVetoQuery,
      );

      const MS_PER_DAY = 24 * 60 * 60 * 1000;
      const toEpochSeconds = (ms: number) => Math.floor(ms / 1000).toString();

      let rangeTo = +range_to || Date.now();
      if (rangeTo < 10000000000) rangeTo *= 1000;

      const formattedRangeTo = toEpochSeconds(rangeTo);
      const rangeFrom = toEpochSeconds(
        rangeTo - HISTORY_LOOKBACK_DAYS * MS_PER_DAY,
      );

      const cont_flag = 1;
      const oi_flag = 0;
      const date_format = 0;

      const [res5m, res15m, res1h] = await Promise.all([
        fastify.fyers.getHistory({
          symbol,
          resolution: '5',
          range_from: rangeFrom,
          range_to: formattedRangeTo,
          cont_flag,
          oi_flag,
          date_format,
        }),
        fastify.fyers.getHistory({
          symbol,
          resolution: '15',
          range_from: rangeFrom,
          range_to: formattedRangeTo,
          cont_flag,
          oi_flag,
          date_format,
        }),
        fastify.fyers.getHistory({
          symbol,
          resolution: '60',
          range_from: rangeFrom,
          range_to: formattedRangeTo,
          cont_flag,
          oi_flag,
          date_format,
        }),
      ]);

      if (
        res5m.s !== ResponseStatus.ok ||
        res15m.s !== ResponseStatus.ok ||
        res1h.s !== ResponseStatus.ok
      ) {
        return reply.code(HttpStatusCode.BadRequest).send({
          error: res5m.message || res15m.message || res1h.message,
        });
      }

      const candles5m = res5m.candles;
      const candles15m = res15m.candles;
      const candles1h = res1h.candles;

      // Parse trading style (aligns with /score-metrics)
      const styleStr = (styleQuery || 'INTRADAY').toUpperCase();
      let activeStyle = TradingStyle.Intraday;
      if (styleStr === 'SCALPER' || styleStr === TradingStyle.Scalper) {
        activeStyle = TradingStyle.Scalper;
      } else if (
        styleStr === 'POSITIONAL' ||
        styleStr === TradingStyle.Positional
      ) {
        activeStyle = TradingStyle.Positional;
      }

      // Compute swings + structures + SR for all TFs (needed for primary + confluence)
      const swings5m = fastify.technicalAnalysisPlugin.getSwings(candles5m);
      const swings15m = fastify.technicalAnalysisPlugin.getSwings(candles15m);
      const swings1h = fastify.technicalAnalysisPlugin.getSwings(candles1h);

      const ms5m = fastify.technicalAnalysisPlugin.getMarketStructure(swings5m);
      const ms15m =
        fastify.technicalAnalysisPlugin.getMarketStructure(swings15m);
      const ms1h = fastify.technicalAnalysisPlugin.getMarketStructure(swings1h);

      const sr5m =
        fastify.technicalAnalysisPlugin.getSupportAndResistance(swings5m);
      const sr15m =
        fastify.technicalAnalysisPlugin.getSupportAndResistance(swings15m);
      const sr1h =
        fastify.technicalAnalysisPlugin.getSupportAndResistance(swings1h);

      // Detectors needed for scoring + primary signal
      const breakout5m = fastify.technicalAnalysisPlugin.detectBreakout(
        candles5m,
        sr5m.support,
        sr5m.resistance,
      );
      const breakout15m = fastify.technicalAnalysisPlugin.detectBreakout(
        candles15m,
        sr15m.support,
        sr15m.resistance,
      );
      const breakout1h = fastify.technicalAnalysisPlugin.detectBreakout(
        candles1h,
        sr1h.support,
        sr1h.resistance,
      );

      const vol5m = fastify.technicalAnalysisPlugin.volumeScore(candles5m);
      const vol15m = fastify.technicalAnalysisPlugin.volumeScore(candles15m);
      const vol1h = fastify.technicalAnalysisPlugin.volumeScore(candles1h);

      const trendBias5m =
        fastify.technicalAnalysisPlugin.swingTrendBias(swings5m);
      const trendBias15m =
        fastify.technicalAnalysisPlugin.swingTrendBias(swings15m);
      const trendBias1h =
        fastify.technicalAnalysisPlugin.swingTrendBias(swings1h);

      const bos5m = fastify.technicalAnalysisPlugin.detectBOS(
        candles5m,
        swings5m,
      );
      const bos15m = fastify.technicalAnalysisPlugin.detectBOS(
        candles15m,
        swings15m,
      );
      const bos1h = fastify.technicalAnalysisPlugin.detectBOS(
        candles1h,
        swings1h,
      );

      const choch5m = fastify.technicalAnalysisPlugin.detectCHOCH(
        candles5m,
        swings5m,
        trendBias5m,
      );
      const choch15m = fastify.technicalAnalysisPlugin.detectCHOCH(
        candles15m,
        swings15m,
        trendBias15m,
      );
      const choch1h = fastify.technicalAnalysisPlugin.detectCHOCH(
        candles1h,
        swings1h,
        trendBias1h,
      );

      const ls5m = fastify.technicalAnalysisPlugin.detectLiquiditySweep(
        candles5m,
        swings5m,
      );
      const ls15m = fastify.technicalAnalysisPlugin.detectLiquiditySweep(
        candles15m,
        swings15m,
      );
      const ls1h = fastify.technicalAnalysisPlugin.detectLiquiditySweep(
        candles1h,
        swings1h,
      );

      // New structure + volatility elements (FVG, OB, PDH/L, ATR, ADX)
      const fvg5m =
        fastify.technicalAnalysisPlugin.detectFairValueGaps(candles5m);
      const fvg15m =
        fastify.technicalAnalysisPlugin.detectFairValueGaps(candles15m);
      const fvg1h =
        fastify.technicalAnalysisPlugin.detectFairValueGaps(candles1h);

      const ob5m = fastify.technicalAnalysisPlugin.detectOrderBlocks(candles5m);
      const ob15m =
        fastify.technicalAnalysisPlugin.detectOrderBlocks(candles15m);
      const ob1h = fastify.technicalAnalysisPlugin.detectOrderBlocks(candles1h);

      const pdhl5m =
        fastify.technicalAnalysisPlugin.getPreviousDayHighLow(candles5m);
      const pdhl15m =
        fastify.technicalAnalysisPlugin.getPreviousDayHighLow(candles15m);
      const pdhl1h =
        fastify.technicalAnalysisPlugin.getPreviousDayHighLow(candles1h);

      const atr5m = fastify.technicalAnalysisPlugin.calculateATR(candles5m);
      const atr15m = fastify.technicalAnalysisPlugin.calculateATR(candles15m);
      const atr1h = fastify.technicalAnalysisPlugin.calculateATR(candles1h);

      const adx5m = fastify.technicalAnalysisPlugin.calculateADX(candles5m);
      const adx15m = fastify.technicalAnalysisPlugin.calculateADX(candles15m);
      const adx1h = fastify.technicalAnalysisPlugin.calculateADX(candles1h);

      const fakeout5m = fastify.technicalAnalysisPlugin.detectFakeout(
        candles5m,
        sr5m.support,
        sr5m.resistance,
      );
      const fakeout15m = fastify.technicalAnalysisPlugin.detectFakeout(
        candles15m,
        sr15m.support,
        sr15m.resistance,
      );
      const fakeout1h = fastify.technicalAnalysisPlugin.detectFakeout(
        candles1h,
        sr1h.support,
        sr1h.resistance,
      );

      const recentMomentum5m =
        fastify.momentumDecayPlugin.computeRecentCandleMomentum(candles5m);
      const recentMomentum15m =
        fastify.momentumDecayPlugin.computeRecentCandleMomentum(candles15m);
      const recentMomentum1h =
        fastify.momentumDecayPlugin.computeRecentCandleMomentum(candles1h);

      const countRecentStructure = (
        items: Array<{ type: 'bullish' | 'bearish' }>,
        type: 'bullish' | 'bearish',
        lookback = 3,
      ) => items.slice(-lookback).filter((item) => item.type === type).length;

      const candlestick5m = detectCandlestickPattern(candles5m);
      const candlestick15m = detectCandlestickPattern(candles15m);
      const candlestick1h = detectCandlestickPattern(candles1h);
      const candlestickBoostFor = (boost: number) =>
        activeStyle === TradingStyle.Intraday && CANDLESTICK_SCORING.ENABLED_FOR_INTRADAY
          ? boost
          : 0;

      const enhancementsEnabled =
        activeStyle === TradingStyle.Intraday &&
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

      // Per-TF context scores blend structure with recent candle momentum
      const score5m = fastify.technicalAnalysisPlugin.scoreTimeFrameContext({
        structure: ms5m,
        breakout: breakout5m,
        retest: fastify.technicalAnalysisPlugin.detectRetest(
          candles5m,
          sr5m.support,
          sr5m.resistance,
        ),
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

      const score15m = fastify.technicalAnalysisPlugin.scoreTimeFrameContext({
        structure: ms15m,
        breakout: breakout15m,
        retest: fastify.technicalAnalysisPlugin.detectRetest(
          candles15m,
          sr15m.support,
          sr15m.resistance,
        ),
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

      const score1h = fastify.technicalAnalysisPlugin.scoreTimeFrameContext({
        structure: ms1h,
        breakout: breakout1h,
        retest: fastify.technicalAnalysisPlugin.detectRetest(
          candles1h,
          sr1h.support,
          sr1h.resistance,
        ),
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

      // Select primary TF data based on trading style
      let primaryCandles: any[];
      let primarySwings: any;
      let primaryBreakout: number;
      let primaryVolume: number;
      let primarySR: { support: number; resistance: number };
      let primaryTimeframe: '5m' | '15m' | '1h';

      if (activeStyle === TradingStyle.Scalper) {
        primaryCandles = candles5m;
        primarySwings = swings5m;
        primaryBreakout = breakout5m;
        primaryVolume = vol5m;
        primarySR = sr5m;
        primaryTimeframe = '5m';
      } else if (activeStyle === TradingStyle.Positional) {
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
        activeStyle === TradingStyle.Scalper ? candles5m : candles15m,
      );
      const sessionBias = analyzeSessionBias(rangeTo, score15m, score1h);
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
      const atrCompression =
        fastify.technicalAnalysisPlugin.computeRangeCompression(primaryCandles);
      const primaryAtr =
        primaryTimeframe === '5m'
          ? atr5m
          : primaryTimeframe === '15m'
            ? atr15m
            : atr1h;

      // One clear confluent actionable signal (MTF aware)
      const confluentSignal =
        fastify.technicalAnalysisPlugin.getConfluentTradeSignal({
          entryVetoMode,
          tradingStyle: activeStyle,
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

      // Slim MTF view for context
      const mtfScore =
        MTF_SCORE_WEIGHTS['5m'] * score5m +
        MTF_SCORE_WEIGHTS['15m'] * score15m +
        MTF_SCORE_WEIGHTS['1h'] * score1h;

      const timeframeScores = {
        '5m': score5m,
        '15m': score15m,
        '1h': score1h,
      };
      const alignedCount = countAlignedTimeframes(
        timeframeScores,
        primaryTimeframe,
      );
      const higherTFConfirmation = isHigherTfSupportive(
        timeframeScores,
        primaryTimeframe,
        ms1h,
      );

      reply.send({
        symbol,
        lastPrice: primaryLastPrice,
        tradingStyle: activeStyle,
        primaryTimeframe,
        signal: {
          action: confluentSignal.action,
          entry: confluentSignal.entry,
          stopLoss: confluentSignal.stopLoss,
          takeProfits: confluentSignal.takeProfits,
          confidence: confluentSignal.confidence,
          strength: confluentSignal.strength,
          vetoReason: confluentSignal.entryVetoReason,
          structuralAction: confluentSignal.structuralAction,
          confidenceBeforeDecay: confluentSignal.confidenceBeforeDecay,
        },
        candlestick: {
          primary: candlestickPrimary.pattern,
          '5m': candlestick5m.pattern,
          '15m': candlestick15m.pattern,
          '1h': candlestick1h.pattern,
        },
        confluence: {
          mtfScore: +mtfScore.toFixed(3),
          aligned: alignedCount,
          total: 3,
          higherTimeframeConfirmation: higherTFConfirmation,
          summary:
            confluentSignal.action === 'NO-TRADE'
              ? `${alignedCount}/3 timeframes share the primary (${primaryTimeframe}) direction. ${higherTFConfirmation ? '1h supports primary.' : '1h does not confirm primary.'}`
              : `${alignedCount}/3 timeframes aligned with primary (${primaryTimeframe}). ${higherTFConfirmation ? '1h supports primary.' : '1h mixed/neutral vs primary.'}`,
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
            '5m': fvg5m.slice(-3), // recent
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
              chartPatternStatus: chartPatternPrimary.status,
              chartPatternDirection: chartPatternPrimary.direction,
              candlestickPrimary: candlestickPrimary.pattern,
              volatility: volatilityRegime,
              session: sessionBias,
              trendQuality,
            }
          : undefined,
      });
    } catch (error) {
      reply.status(HttpStatusCode.InternalServerError).send({ error });
    }
  });
}
