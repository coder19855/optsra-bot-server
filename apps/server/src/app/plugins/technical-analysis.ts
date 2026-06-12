import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { FyersAPI } from 'fyers-api-v3';
import { ATR, ADX } from 'technicalindicators';
import {
  CONFLUENCE_ENHANCEMENTS,
  ENTRY_VETO,
  MIN_CONFIDENCE_AFTER_DECAY,
  REGIME_FILTERS,
  TA_CONFIDENCE,
  TREND_CONTEXT_SCORING,
} from '../constants/technical-analysis';
import { MOMENTUM_DECAY } from '../constants/momentum-decay';
import {
  CandlestickPatternResult,
  ChartPatternResult,
  SessionBias,
  TrendQuality,
  VolatilityRegime,
} from '../types/technical-analysis';
import { normalizeStopLoss } from '../technical-analysis/stop-utils';
import { BiasSignal, PriceActionTradeRecommendation, Swing } from '../types';
import { TradingStyle } from '../types/trading-style';
import { StructureType } from '../types/technical-analysis';

export default fp(
  async (fastify: FastifyInstance) => {
    const {
      computeMomentumDecay,
      applyMomentumDecay,
    } = fastify.momentumDecayPlugin;
    const getSwings = (candles: FyersAPI.Candle[]): Swing => {
      const rawHighs: { index: number; price: number }[] = [];
      const rawLows: { index: number; price: number }[] = [];

      // Step 1: detect all raw pivots
      for (let i = 1; i < candles.length - 1; i++) {
        const prevHigh = candles[i - 1][2];
        const nextHigh = candles[i + 1][2];
        const prevLow = candles[i - 1][3];
        const nextLow = candles[i + 1][3];
        const currentHigh = candles[i][2];
        const currentLow = candles[i][3];

        if (currentHigh > prevHigh && currentHigh > nextHigh) {
          rawHighs.push({ index: i, price: currentHigh });
        }

        if (currentLow < prevLow && currentLow < nextLow) {
          rawLows.push({ index: i, price: currentLow });
        }
      }

      // Step 2: merge and sort by index
      const pivots = [
        ...rawHighs.map((h) => ({ ...h, type: 'H' as const })),
        ...rawLows.map((l) => ({ ...l, type: 'L' as const })),
      ].sort((a, b) => a.index - b.index);

      // Step 3: enforce alternation H → L → H → L, keeping only more extreme when same type
      const clean: { index: number; price: number; type: 'H' | 'L' }[] = [];
      for (const p of pivots) {
        if (clean.length === 0) {
          clean.push(p);
          continue;
        }

        const last = clean[clean.length - 1];

        if (last.type === p.type) {
          if (p.type === 'H' && p.price > last.price) {
            clean[clean.length - 1] = p;
          }
          if (p.type === 'L' && p.price < last.price) {
            clean[clean.length - 1] = p;
          }
          continue;
        }

        clean.push(p);
      }

      // Step 4: split back into highs/lows
      const highs = clean
        .filter((p) => p.type === 'H')
        .map((p) => ({
          index: p.index,
          price: p.price,
          timestamp: new Date(candles[p.index][0] * 1000).toLocaleString(),
        }));

      const lows = clean
        .filter((p) => p.type === 'L')
        .map((p) => ({
          index: p.index,
          price: p.price,
          timestamp: new Date(candles[p.index][0] * 1000).toLocaleString(),
        }));

      return { highs, lows };
    };

    const getMarketStructure = (swings: Swing) => {
      const lastHighs = swings.highs.slice(-2);
      const lastLows = swings.lows.slice(-2);

      if (lastHighs.length < 2 || lastLows.length < 2) {
        return 0; // neutral
      }

      if (
        lastHighs[1].price > lastHighs[0].price &&
        lastLows[1].price > lastLows[0].price
      )
        return 1; // bullish (HH + HL)

      if (
        lastHighs[1].price < lastHighs[0].price &&
        lastLows[1].price < lastLows[0].price
      )
        return -1; // bearish (LH + LL)

      return 0; // neutral / mixed
    };

    const getSupportAndResistance = (swings: Swing, lookback = 5) => {
      const highs = swings.highs.slice(-lookback).map((s) => s.price);
      const lows = swings.lows.slice(-lookback).map((s) => s.price);

      if (highs.length === 0 || lows.length === 0) {
        return { support: 0, resistance: Infinity };
      }

      const resistance = Math.max(...highs);
      const support = Math.min(...lows);

      return { support, resistance };
    };

    const detectBreakout = (
      candles: FyersAPI.Candle[],
      support: number,
      resistance: number,
    ) => {
      const last = candles[candles.length - 1];

      if (last[4] > resistance) return 1; // breakout up
      if (last[4] < support) return -1; // breakdown
      return 0;
    };

    const detectFakeout = (
      candles: FyersAPI.Candle[],
      support: number,
      resistance: number,
    ) => {
      const last = candles[candles.length - 1];

      const wickAbove = last[2] > resistance && last[4] < resistance;
      const wickBelow = last[3] < support && last[4] > support;

      if (wickAbove) return -1; // bearish fakeout
      if (wickBelow) return 1; // bullish fakeout

      return 0;
    };

    const detectRetest = (
      candles: FyersAPI.Candle[],
      support: number,
      resistance: number,
    ) => {
      const last = candles.length - 1;
      const prev = candles.length - 2;

      const brokeUp = candles[prev][4] > resistance;
      const retestUp =
        candles[last][3] <= resistance && candles[last][4] > resistance;

      if (brokeUp && retestUp) return 1;

      const brokeDown = candles[prev][4] < support;
      const retestDown =
        candles[last][2] >= support && candles[last][4] < support;

      if (brokeDown && retestDown) return -1;

      return 0;
    };

    const volumeScore = (candles: FyersAPI.Candle[]) => {
      const last = candles[candles.length - 1][5];
      const avg = candles.slice(-20).reduce((a, c) => a + c[5], 0) / 20;

      if (last > avg * 1.5) return 1; // strong volume
      if (last < avg * 0.7) return -1; // weak volume
      return 0;
    };

    const swingTrendBias = (swings: Swing): number => {
      if (swings.highs.length < 2 || swings.lows.length < 2) {
        return 0;
      }

      const lastHigh = swings.highs[swings.highs.length - 1].price;
      const prevHigh = swings.highs[swings.highs.length - 2].price;

      const lastLow = swings.lows[swings.lows.length - 1].price;
      const prevLow = swings.lows[swings.lows.length - 2].price;

      const higherHigh = lastHigh > prevHigh;
      const higherLow = lastLow > prevLow;

      const lowerHigh = lastHigh < prevHigh;
      const lowerLow = lastLow < prevLow;

      if (higherHigh && higherLow) return 1; // bullish
      if (lowerHigh && lowerLow) return -1; // bearish
      return 0; // sideways / mixed
    };

    // ---- SMC: BOS, CHOCH, Liquidity Sweep -------------------------------

    const detectBOS = (candles: FyersAPI.Candle[], swings: Swing): number => {
      if (swings.highs.length < 2 || swings.lows.length < 2) return 0;

      const lastClose = candles[candles.length - 1][4];
      const lastHigh = swings.highs[swings.highs.length - 1].price;
      const lastLow = swings.lows[swings.lows.length - 1].price;

      // Bullish BOS: close above last swing high
      if (lastClose > lastHigh) return 1;

      // Bearish BOS: close below last swing low
      if (lastClose < lastLow) return -1;

      return 0;
    };

    const detectCHOCH = (
      candles: FyersAPI.Candle[],
      swings: Swing,
      trendBias: number,
    ): number => {
      if (swings.highs.length < 2 || swings.lows.length < 2) return 0;

      const lastClose = candles[candles.length - 1][4];
      const lastHigh = swings.highs[swings.highs.length - 1].price;
      const lastLow = swings.lows[swings.lows.length - 1].price;

      // If we were bullish (HH/HL) and price breaks last swing low → bearish CHOCH
      if (trendBias > 0 && lastClose < lastLow) return -1;

      // If we were bearish (LH/LL) and price breaks last swing high → bullish CHOCH
      if (trendBias < 0 && lastClose > lastHigh) return 1;

      return 0;
    };

    const detectLiquiditySweep = (
      candles: FyersAPI.Candle[],
      swings: Swing,
    ): number => {
      if (swings.highs.length < 1 || swings.lows.length < 1) return 0;

      const last = candles[candles.length - 1];
      const close = last[4];
      const high = last[2];
      const low = last[3];

      const lastHigh = swings.highs[swings.highs.length - 1].price;
      const lastLow = swings.lows[swings.lows.length - 1].price;

      // Sweep above high: wick through high, close back below
      if (high > lastHigh && close < lastHigh) return -1; // bearish sweep

      // Sweep below low: wick through low, close back above
      if (low < lastLow && close > lastLow) return 1; // bullish sweep

      return 0;
    };

    const scoreTimeFrameContext = ({
      structure,
      breakout,
      retest,
      volume,
      fakeout,
      trendBias,
      bos,
      choch,
      liquiditySweep,
      // New SMC/ATR/ADX contributions (optional, small weights)
      fvgCount = 0,
      obCount = 0,
      bullishFvgCount = 0,
      bearishFvgCount = 0,
      bullishObCount = 0,
      bearishObCount = 0,
      atr = 0,
      adx = 0,
      recentMomentum = 0,
      candlestickBoost = 0,
      chartPatternBoost = 0,
    }: {
      structure: number;
      breakout: number;
      retest: number;
      volume: number;
      fakeout: number;
      trendBias: number;
      bos: number;
      choch: number;
      liquiditySweep: number;
      fvgCount?: number;
      obCount?: number;
      bullishFvgCount?: number;
      bearishFvgCount?: number;
      bullishObCount?: number;
      bearishObCount?: number;
      atr?: number;
      adx?: number;
      recentMomentum?: number;
      candlestickBoost?: number;
      chartPatternBoost?: number;
    }) => {
      // Base SMC score (unchanged)
      const baseScore =
        0.25 * structure +
        0.2 * breakout +
        0.1 * retest +
        0.05 * volume +
        0.05 * fakeout +
        0.1 * trendBias +
        0.15 * bos +
        0.05 * choch +
        0.05 * liquiditySweep;

      // Directional structure: bullish elements help, bearish elements hurt
      const netFvg =
        Math.min(1, bullishFvgCount) * 0.08 -
        Math.min(1, bearishFvgCount) * 0.1;
      const netOb =
        Math.min(1, bullishObCount) * 0.1 -
        Math.min(1, bearishObCount) * 0.12;
      const atrBoost = atr > 0 ? 0.06 : 0;
      const adxBoost = Math.min(1, adx / 25) * 0.08;
      const momentumBoost =
        recentMomentum * TREND_CONTEXT_SCORING.MOMENTUM_WEIGHT;

      let trendContextAdj = 0;
      if (trendBias === 1) {
        trendContextAdj += TREND_CONTEXT_SCORING.TREND_BIAS_BULLISH_BONUS;
      } else if (trendBias === -1) {
        trendContextAdj -= TREND_CONTEXT_SCORING.TREND_BIAS_BEARISH_PENALTY;
      } else {
        trendContextAdj -= TREND_CONTEXT_SCORING.TREND_BIAS_MIXED_PENALTY;
      }

      return (
        baseScore +
        netFvg +
        netOb +
        atrBoost +
        adxBoost +
        momentumBoost +
        trendContextAdj +
        candlestickBoost +
        chartPatternBoost
      );
    };

    /** 0 = normal range, 1 = strong compression (recent bars much tighter). */
    const computeRangeCompression = (candles: FyersAPI.Candle[]): number => {
      if (candles.length < 12) return 0;

      const ranges = candles.map((c) => c[2] - c[3]);
      const recent = ranges.slice(-3);
      const baseline = ranges.slice(-20, -3);
      if (baseline.length < 5) return 0;

      const recentAvg =
        recent.reduce((sum, value) => sum + value, 0) / recent.length;
      const baselineAvg =
        baseline.reduce((sum, value) => sum + value, 0) / baseline.length;

      if (baselineAvg <= 0) return 0;

      const ratio = recentAvg / baselineAvg;
      if (ratio >= REGIME_FILTERS.COMPRESSION_RANGE_RATIO) return 0;

      return Math.min(
        1,
        1 - ratio / REGIME_FILTERS.COMPRESSION_RANGE_RATIO,
      );
    };

    const getTradeRecommendationFromScore = (
      score: number,
    ): PriceActionTradeRecommendation => {
      if (score >= 0.6) return PriceActionTradeRecommendation.BreakoutLong;
      if (score >= 0.3) return PriceActionTradeRecommendation.PullbackLong;
      if (score >= 0.2) return PriceActionTradeRecommendation.ScalpLong;

      if (score > -0.2 && score < 0.2)
        return PriceActionTradeRecommendation.AvoidNoise;

      if (score <= -0.2 && score > -0.3)
        return PriceActionTradeRecommendation.ScalpShort;
      if (score <= -0.3 && score > -0.6)
        return PriceActionTradeRecommendation.PullbackShort;

      return PriceActionTradeRecommendation.BreakoutShort;
    };

    // You can still keep the pattern-based bias if you like,
    // but now it’s optional. For simplicity we’ll derive bias
    // from 1h score + structure.
    const getBiasSignalFromScores = ({
      score5m,
      score15m,
      score1h,
      structure1h,
    }: {
      score5m: number;
      score15m: number;
      score1h: number;
      structure1h: number;
    }): BiasSignal => {
      // Strong higher TF downtrend
      if (score1h <= -0.3 || structure1h === -1) {
        return BiasSignal.BearishTrendStart;
      }

      // Strong higher TF uptrend
      if (score1h >= 0.3 || structure1h === 1) {
        return BiasSignal.BullishTrendStart;
      }

      // Mild bearish intraday
      if (score5m < -0.2 && score15m < -0.2) {
        return BiasSignal.BearishTransition;
      }

      // Mild bullish intraday
      if (score5m > 0.2 && score15m > 0.2) {
        return BiasSignal.BullishTransition;
      }

      return BiasSignal.Neutral;
    };

    const getTradeSignal = ({
      lastPrice,
      biasSignal,
      score,
      swings,
      volume,
      breakout,
      tradingStyle,
    }: {
      lastPrice: number;
      biasSignal: BiasSignal;
      score: number;
      swings: Swing;
      volume: number;
      breakout: number;
      tradingStyle: TradingStyle;
    }) => {
      const threshold =
        tradingStyle === TradingStyle.Scalper
          ? 0.15
          : tradingStyle === TradingStyle.Positional
            ? 0.38
            : 0.3;

      let direction: 'CE-BUY' | 'PE-BUY' | 'NO-TRADE' = 'NO-TRADE';

      const bullish =
        biasSignal === BiasSignal.BullishTrendStart ||
        biasSignal === BiasSignal.BullishTransition ||
        biasSignal === BiasSignal.BullishFakeoutReversal ||
        (score > threshold && breakout !== -1);

      const bearish =
        biasSignal === BiasSignal.BearishTrendStart ||
        biasSignal === BiasSignal.BearishTransition ||
        biasSignal === BiasSignal.BearishFakeoutReversal ||
        (score < -threshold && breakout !== 1);

      if (bullish) direction = 'CE-BUY';
      if (bearish) direction = 'PE-BUY';

      const entry = direction === 'NO-TRADE' ? 0 : lastPrice;

      let sl = 0;
      let tp: number[] = [];

      if (direction === 'CE-BUY') {
        sl = swings.lows.at(-1)?.price || 0;
        const risk = entry - sl;
        tp = [1, 2, 3, 4, 5].map((r) => entry + risk * r);
      }

      if (direction === 'PE-BUY') {
        sl = swings.highs.at(-1)?.price || 0;
        const risk = sl - entry;
        tp = [1, 2, 3, 4, 5].map((r) => entry - risk * r);
      }

      let confidence = 0;

      confidence += Math.min(Math.abs(score) * 40, 40);
      confidence += biasSignal !== BiasSignal.Neutral ? 30 : 0;

      if (tradingStyle === TradingStyle.Scalper) {
        confidence += volume === 1 ? 20 : 0;
        confidence += breakout !== 0 ? 10 : 0;
      }

      if (tradingStyle === TradingStyle.Intraday) {
        confidence += volume === 1 ? 10 : 0;
        confidence += breakout !== 0 ? 5 : 0;
      }

      confidence = Math.min(confidence, 100);

      const rrLevels = ['1:1', '1:2', '1:3', '1:4', '1:5'];

      const takeProfitsWithConfidence = tp.map((price, idx) => {
        const rrIndex = idx + 1;
        const decay = Math.min(0.6, (rrIndex - 1) * 0.12);
        const conf = Math.round(confidence * Math.max(0.2, 1 - decay));
        return {
          price,
          rr: rrLevels[idx] ?? `${rrIndex}:1`,
          confidence: conf,
        };
      });

      return {
        direction,
        entry,
        stoploss: sl,
        takeProfits: takeProfitsWithConfidence,
        rrLevels,
        confidence: direction === 'NO-TRADE' ? 0 : confidence,
      };
    };

    /**
     * Multi-timeframe confluent trade signal.
     * Primary TF is chosen by tradingStyle:
     *   SCALPER   -> 5m
     *   INTRADAY  -> 15m
     *   POSITIONAL-> 1h
     *
     * Increases confluence by checking alignment across 5m/15m/1h scores + 1h market structure.
     * Returns one clear actionable signal instead of conflicting per-TF signals.
     */
    const getOpposing15mStructure = (
      isBullish: boolean,
      structureElements:
        | {
            fvg?: Record<string, Array<{ type: StructureType }>>;
            orderBlocks?: Record<string, Array<{ type: StructureType }>>;
          }
        | undefined,
    ) => {
      const opposingType: StructureType = isBullish ? 'bearish' : 'bullish';
      const fvgs15 = structureElements?.fvg?.['15m'] || [];
      const obs15 = structureElements?.orderBlocks?.['15m'] || [];

      const hasOpposingFvg = fvgs15
        .slice(-MOMENTUM_DECAY.RECENT_FVG_COUNT)
        .some((e) => e.type === opposingType);
      const hasOpposingOb = obs15
        .slice(-MOMENTUM_DECAY.RECENT_OB_COUNT)
        .some((e) => e.type === opposingType);

      return { hasOpposingFvg, hasOpposingOb, hasAny: hasOpposingFvg || hasOpposingOb };
    };

    const countStackedOpposingSignals = (
      isBullish: boolean,
      structureElements:
        | {
            fvg?: Record<string, Array<{ type: StructureType }>>;
            orderBlocks?: Record<string, Array<{ type: StructureType }>>;
          }
        | undefined,
      recentMomentum15m: number,
    ): number => {
      const { hasOpposingFvg, hasOpposingOb } = getOpposing15mStructure(
        isBullish,
        structureElements,
      );
      let count = 0;

      if (hasOpposingFvg) count++;
      if (hasOpposingOb) count++;

      if (isBullish && recentMomentum15m < 0) count++;
      if (!isBullish && recentMomentum15m > 0) count++;

      return count;
    };

    const getConfluentTradeSignal = (params: {
      skipEntryVeto?: boolean;
      entryVetoMode?: import('../types/veto-mode').VetoMode;
      tradingStyle: TradingStyle;
      scores: { score5m: number; score15m: number; score1h: number };
      structures: { ms5m: number; ms15m: number; ms1h: number };
      primary: {
        lastPrice: number;
        swings: Swing;
        volume: number;
        breakout: number;
        support: number;
        resistance: number;
      };
      momentum?: {
        fakeout15m?: number;
        adx5m?: number;
        adx15m?: number;
        adx1h?: number;
        recentMomentum5m?: number;
        recentMomentum15m?: number;
        atrCompression?: number;
        primaryAtr?: number;
        candlestickPrimary?: CandlestickPatternResult;
        candlestick15m?: CandlestickPatternResult;
        chartPatternPrimary?: ChartPatternResult;
        volatilityRegime?: VolatilityRegime;
        sessionBias?: SessionBias;
        trendQuality?: TrendQuality;
        structureElements?: {
          fvg?: Record<string, Array<{ type: 'bullish' | 'bearish' }>>;
          orderBlocks?: Record<string, Array<{ type: 'bullish' | 'bearish' }>>;
        };
      };
    }) => {
      const { tradingStyle, scores, structures, primary, momentum } = params;
      const entryVetoMode =
        params.entryVetoMode ??
        (params.skipEntryVeto ? 'off' : 'strict');
      const vetoOff = entryVetoMode === 'off';
      const vetoRelaxed = entryVetoMode === 'relaxed';
      const regime = REGIME_FILTERS;
      const veto = ENTRY_VETO;
      const enhance = CONFLUENCE_ENHANCEMENTS;
      let entryVetoReason: string | undefined;
      const noteVeto = (reason: string) => {
        if (!entryVetoReason) entryVetoReason = reason;
      };

      const primaryTf =
        tradingStyle === TradingStyle.Scalper
          ? ('5m' as const)
          : tradingStyle === TradingStyle.Positional
            ? ('1h' as const)
            : ('15m' as const);

      const primaryScore =
        primaryTf === '5m'
          ? scores.score5m
          : primaryTf === '15m'
            ? scores.score15m
            : scores.score1h;

      // Determine direction from primary score (stronger than old biasSignal)
      const isBullishPrimary = primaryScore > 0.08;
      const isBearishPrimary = primaryScore < -0.08;

      // Confluence: how many TFs agree in sign with primary
      const primarySign = Math.sign(primaryScore);
      let aligned = 0;
      if (Math.sign(scores.score5m) === primarySign && primarySign !== 0) aligned++;
      if (Math.sign(scores.score15m) === primarySign && primarySign !== 0) aligned++;
      if (Math.sign(scores.score1h) === primarySign && primarySign !== 0) aligned++;

      // Higher TF (1h) confirmation is important for non-scalper
      const higherTFAligned =
        (isBullishPrimary && (structures.ms1h === 1 || scores.score1h > 0.1)) ||
        (isBearishPrimary && (structures.ms1h === -1 || scores.score1h < -0.1));

      // Style-specific confluence gates + effective strength
      let allowTrade = false;
      let confluenceBoost = 0;

      if (tradingStyle === TradingStyle.Scalper) {
        // Scalper can take aggressive 5m moves even if 1h is neutral, but wants 15m not strongly against
        const fifteenMinAgainst =
          (isBullishPrimary && scores.score15m < -0.35) ||
          (isBearishPrimary && scores.score15m > 0.35);
        allowTrade = !fifteenMinAgainst && (Math.abs(primaryScore) > 0.12 || primary.breakout !== 0);
        confluenceBoost = aligned >= 2 ? 25 : aligned === 1 ? 12 : 0;
        if (higherTFAligned) confluenceBoost += 10;
      } else if (tradingStyle === TradingStyle.Intraday) {
        // Intraday wants decent alignment (at least 2 TFs or strong 1h support)
        const minAligned = higherTFAligned ? 1 : 2;
        allowTrade = aligned >= minAligned && Math.abs(primaryScore) > 0.22;
        confluenceBoost = aligned * 12 + (higherTFAligned ? 18 : 0);
      } else {
        // POSITIONAL: strict. Require 1h structure/score leadership + 15m support
        const oneHourStrong =
          (isBullishPrimary && (structures.ms1h === 1 || scores.score1h >= 0.25)) ||
          (isBearishPrimary && (structures.ms1h === -1 || scores.score1h <= -0.25));
        const fifteenSupport =
          (isBullishPrimary && scores.score15m > -0.15) ||
          (isBearishPrimary && scores.score15m < 0.15);
        allowTrade = oneHourStrong && fifteenSupport && Math.abs(primaryScore) > 0.28;
        confluenceBoost = (oneHourStrong ? 30 : 0) + (fifteenSupport ? 15 : -15) + aligned * 8;
      }

      const primaryMs =
        primaryTf === '5m'
          ? structures.ms5m
          : primaryTf === '15m'
            ? structures.ms15m
            : structures.ms1h;
      const primaryAdx =
        primaryTf === '5m'
          ? momentum?.adx5m
          : primaryTf === '15m'
            ? momentum?.adx15m
            : momentum?.adx1h;

      // Step 2: chop — weak ADX + weak conviction → no trend trade
      if (
        allowTrade &&
        primaryAdx !== undefined &&
        primaryAdx < regime.CHOP_ADX_THRESHOLD &&
        Math.abs(primaryScore) < regime.CHOP_MAX_ABS_SCORE
      ) {
        allowTrade = false;
        noteVeto('Chop regime: weak ADX and low conviction on primary TF');
      }

      // Step 2: compression — tight range → need stronger score for trend entry
      if (
        allowTrade &&
        momentum?.atrCompression !== undefined &&
        momentum.atrCompression > 0 &&
        Math.abs(primaryScore) < regime.COMPRESSION_MIN_ABS_SCORE
      ) {
        allowTrade = false;
        noteVeto('Range compression: score too weak for trend entry');
      }

      // Step 1: intraday — block CE when 5m opposes unless 15m momentum is strong
      if (tradingStyle === TradingStyle.Intraday && allowTrade) {
        const mom15 = momentum?.recentMomentum15m ?? 0;

        if (
          isBullishPrimary &&
          scores.score5m < -regime.OPPOSE_5M_THRESHOLD &&
          mom15 <= regime.STRONG_15M_MOMENTUM
        ) {
          allowTrade = false;
          noteVeto('5m opposes CE and 15m momentum is not strong enough');
        }

        if (
          isBearishPrimary &&
          scores.score5m > regime.OPPOSE_5M_THRESHOLD &&
          mom15 >= -regime.STRONG_15M_MOMENTUM
        ) {
          allowTrade = false;
          noteVeto('5m opposes PE and 15m momentum is not strong enough');
        }

        // LH/LL on primary TF should not fire CE unless momentum confirms
        if (
          isBullishPrimary &&
          primaryMs === -1 &&
          mom15 <= regime.STRONG_15M_MOMENTUM
        ) {
          allowTrade = false;
          noteVeto('Bearish market structure on primary TF without 15m confirmation');
        }

        if (
          isBearishPrimary &&
          primaryMs === 1 &&
          mom15 >= -regime.STRONG_15M_MOMENTUM
        ) {
          allowTrade = false;
          noteVeto('Bullish market structure on primary TF without 15m confirmation');
        }

        // Step 2.5: stacked opposing 15m structure + negative momentum
        if (allowTrade) {
          const opposingCount = countStackedOpposingSignals(
            isBullishPrimary,
            momentum?.structureElements,
            mom15,
          );
          if (opposingCount >= veto.OPPOSED_STRUCTURE_MIN_SIGNALS) {
            allowTrade = false;
            noteVeto('Stacked opposing 15m structure with conflicting momentum');
          }
        }

        // Step 3.2: CE veto when weak 15m ADX meets bearish 15m order block
        if (allowTrade && isBullishPrimary) {
          const { hasOpposingOb } = getOpposing15mStructure(
            true,
            momentum?.structureElements,
          );
          if (
            momentum?.adx15m !== undefined &&
            momentum.adx15m < veto.INTRADAY_CE_OB_ADX_MAX &&
            hasOpposingOb
          ) {
            allowTrade = false;
            noteVeto('CE blocked: 15m ADX < 15 with opposing order block');
          }
        }

        // Step 3: soft ADX chop — weak trend strength only when conviction is also weak
        if (
          allowTrade &&
          momentum?.adx15m !== undefined &&
          momentum.adx15m < veto.INTRADAY_WEAK_ADX_MAX &&
          Math.abs(primaryScore) < veto.INTRADAY_WEAK_ADX_MIN_ABS_SCORE
        ) {
          allowTrade = false;
          noteVeto('Soft ADX chop: 15m ADX very weak with low primary score');
        }

        // Step 2.5/3: intraday CE needs 1h alignment unless 15m is very strong
        if (
          allowTrade &&
          isBullishPrimary &&
          scores.score1h < veto.INTRADAY_1H_CE_BLOCK_BELOW
        ) {
          allowTrade = false;
          noteVeto('CE blocked: 1h score clearly bearish');
        } else if (allowTrade && isBullishPrimary && scores.score1h < 0) {
          if (
            scores.score15m <= veto.INTRADAY_1H_CE_MIN_SCORE15 ||
            mom15 <= veto.INTRADAY_1H_CE_MIN_MOM15
          ) {
            allowTrade = false;
            noteVeto('CE blocked: mildly bearish 1h without strong 15m override');
          }
        }

        if (allowTrade && isBearishPrimary && scores.score1h > 0) {
          if (
            scores.score15m >= -veto.INTRADAY_1H_CE_MIN_SCORE15 ||
            mom15 >= -veto.INTRADAY_1H_CE_MIN_MOM15
          ) {
            allowTrade = false;
            noteVeto('PE blocked: mildly bullish 1h without strong 15m override');
          }
        }

        // Step 3: PE into support bounce — block fade near support with bullish pressure
        if (allowTrade && isBearishPrimary) {
          const nearSupport =
            primary.support > 0 &&
            primary.lastPrice > 0 &&
            (primary.lastPrice - primary.support) / primary.lastPrice <
              veto.PE_NEAR_SUPPORT_PCT;
          const obs15 = momentum?.structureElements?.orderBlocks?.['15m'] || [];
          const bullishObNear = obs15
            .slice(-MOMENTUM_DECAY.RECENT_OB_COUNT)
            .some((e) => e.type === 'bullish');

          if (nearSupport && (mom15 > 0 || bullishObNear)) {
            allowTrade = false;
            noteVeto('PE blocked: price near support with bullish pressure');
          }
        }

        // Step 4: opposing candlestick on primary TF
        const cs =
          momentum?.candlestickPrimary ?? momentum?.candlestick15m;
        if (allowTrade && cs && isBullishPrimary && cs.direction === 'bearish') {
          allowTrade = false;
          noteVeto(`CE blocked: bearish ${cs.pattern.replace(/_/g, ' ')} on primary TF`);
        }
        if (allowTrade && cs && isBearishPrimary && cs.direction === 'bullish') {
          allowTrade = false;
          noteVeto(`PE blocked: bullish ${cs.pattern.replace(/_/g, ' ')} on primary TF`);
        }

        if (
          allowTrade &&
          isBullishPrimary &&
          cs?.pattern === 'doji' &&
          scores.score15m < veto.INTRADAY_CE_DOJI_MIN_SCORE15
        ) {
          allowTrade = false;
          noteVeto('CE blocked: doji on primary TF with weak 15m conviction');
        }

        // Step 5: volatility regime — skip dead/compressed markets
        if (allowTrade && enhance.ENABLED_FOR_INTRADAY && momentum?.volatilityRegime) {
          if (momentum.volatilityRegime.isDeadMarket) {
            allowTrade = false;
            noteVeto('Dead market: low ATR percentile with session compression');
          }
        }

        // Step 5: trend quality gate
        if (allowTrade && enhance.ENABLED_FOR_INTRADAY && momentum?.trendQuality) {
          const tq = momentum.trendQuality;
          const minQuality =
            momentum.sessionBias?.phase === 'midday'
              ? enhance.MIDDAY_MIN_TREND_QUALITY
              : enhance.MIN_TREND_QUALITY;
          const dirQuality = isBullishPrimary ? tq.bullish : tq.bearish;

          if (dirQuality < minQuality) {
            allowTrade = false;
            noteVeto(
              `Weak trend quality (${dirQuality.toFixed(2)} < ${minQuality}) for ${isBullishPrimary ? 'CE' : 'PE'}`,
            );
          }
        }

        // Step 5: opposing major chart pattern (confirmed only; forming patterns inform score)
        const cp = momentum?.chartPatternPrimary;
        if (allowTrade && cp && cp.pattern !== 'none' && cp.status !== 'forming') {
          if (isBullishPrimary && cp.direction === 'bearish') {
            allowTrade = false;
            noteVeto(`CE blocked: bearish chart pattern (${cp.pattern.replace(/_/g, ' ')})`);
          }
          if (isBearishPrimary && cp.direction === 'bullish') {
            allowTrade = false;
            noteVeto(`PE blocked: bullish chart pattern (${cp.pattern.replace(/_/g, ' ')})`);
          }
        }

        // Step 5: session bias — midday needs stronger primary conviction
        if (
          allowTrade &&
          enhance.ENABLED_FOR_INTRADAY &&
          momentum?.sessionBias?.phase === 'midday' &&
          Math.abs(primaryScore) < 0.28 * (momentum.sessionBias.confluenceMultiplier ?? 1)
        ) {
          allowTrade = false;
          noteVeto('Midday chop: primary score too weak for trend entry');
        }
      }

      let action: 'CE-BUY' | 'PE-BUY' | 'NO-TRADE' = 'NO-TRADE';

      if (vetoOff) {
        if (isBullishPrimary) action = 'CE-BUY';
        else if (isBearishPrimary) action = 'PE-BUY';
      } else {
        if (allowTrade && isBullishPrimary) action = 'CE-BUY';
        if (allowTrade && isBearishPrimary) action = 'PE-BUY';

        // If 1h is strongly against for intraday/positional, veto
        if (
          tradingStyle !== TradingStyle.Scalper &&
          ((isBullishPrimary && scores.score1h < -0.4) ||
            (isBearishPrimary && scores.score1h > 0.4))
        ) {
          action = 'NO-TRADE';
          noteVeto('1h score strongly opposes trade direction');
        }
      }

      if (action === 'NO-TRADE' && !entryVetoReason && !allowTrade) {
        noteVeto('Insufficient confluence or conviction for entry');
      }

      let entry = action === 'NO-TRADE' ? 0 : primary.lastPrice;

      // SL from primary swings (most recent opposing swing), ATR-clamped when available
      let rawStopLoss = 0;
      if (action === 'CE-BUY') {
        rawStopLoss = primary.swings.lows.at(-1)?.price || primary.support || 0;
      } else if (action === 'PE-BUY') {
        rawStopLoss =
          primary.swings.highs.at(-1)?.price || primary.resistance || 0;
      }

      let stopLoss = rawStopLoss;
      if (
        action !== 'NO-TRADE' &&
        momentum?.primaryAtr &&
        momentum.primaryAtr > 0 &&
        rawStopLoss > 0
      ) {
        stopLoss = normalizeStopLoss(
          action,
          entry,
          rawStopLoss,
          momentum.primaryAtr,
        ).stopLoss;
      }

      const rrLabels = ['1:1.5', '1:2.5', '1:4'];

      const baseConfidence = Math.min(
        TA_CONFIDENCE.MAX,
        Math.round(Math.abs(primaryScore) * 55 + 25),
      );
      let finalConfidence = Math.min(
        TA_CONFIDENCE.MAX,
        Math.max(
          TA_CONFIDENCE.MIN_ACTIONABLE,
          Math.round(
            baseConfidence +
              confluenceBoost -
              (action === 'NO-TRADE' ? TA_CONFIDENCE.NO_TRADE_PENALTY : 0),
          ),
        ),
      );

      if (
        action !== 'NO-TRADE' &&
        enhance.ENABLED_FOR_INTRADAY &&
        tradingStyle === TradingStyle.Intraday &&
        momentum?.chartPatternPrimary
      ) {
        const cp = momentum.chartPatternPrimary;
        const aligned =
          (action === 'CE-BUY' && cp.direction === 'bullish') ||
          (action === 'PE-BUY' && cp.direction === 'bearish');
        if (aligned && cp.pattern !== 'none') {
          const formingFactor = cp.status === 'forming' ? 0.5 : 1;
          finalConfidence = Math.min(
            TA_CONFIDENCE.MAX,
            finalConfidence +
              Math.round(
                enhance.ALIGNED_PATTERN_CONFIDENCE_BOOST * formingFactor,
              ),
          );
        }
      }

      if (
        action !== 'NO-TRADE' &&
        enhance.ENABLED_FOR_INTRADAY &&
        tradingStyle === TradingStyle.Intraday &&
        momentum?.candlestickPrimary
      ) {
        const cs = momentum.candlestickPrimary;
        const aligned =
          (action === 'CE-BUY' && cs.direction === 'bullish') ||
          (action === 'PE-BUY' && cs.direction === 'bearish');
        if (aligned && cs.pattern !== 'none' && cs.pattern !== 'doji') {
          finalConfidence = Math.min(
            TA_CONFIDENCE.MAX,
            finalConfidence + enhance.ALIGNED_CANDLESTICK_CONFIDENCE_BOOST,
          );
        }
        const cs15 = momentum.candlestick15m;
        if (
          cs15 &&
          cs.pattern !== 'none' &&
          cs15.pattern !== 'none' &&
          cs.direction === cs15.direction &&
          cs.direction !== 'neutral'
        ) {
          finalConfidence = Math.min(
            TA_CONFIDENCE.MAX,
            finalConfidence + enhance.MULTI_TF_CANDLESTICK_CONFIDENCE_BOOST,
          );
        }
      }

      const structuralAction = action;
      let confidenceBeforeDecay: number | undefined;
      let momentumDecayResult:
        | { decayPercent: number; reasons: string[] }
        | undefined;
      let vetoedByDecay = false;

      if (action !== 'NO-TRADE' && momentum) {
        const direction =
          action === 'CE-BUY'
            ? 'bullish'
            : action === 'PE-BUY'
              ? 'bearish'
              : 'neutral';
        const decay = computeMomentumDecay({
          direction,
          score5m: scores.score5m,
          score15m: scores.score15m,
          lastPrice: primary.lastPrice,
          resistance: primary.resistance,
          support: primary.support,
          adx5m: momentum.adx5m ?? 0,
          adx15m: momentum.adx15m ?? 0,
          adx1h: momentum.adx1h ?? 0,
          primaryTF: primaryTf,
          structureElements: momentum.structureElements,
          fakeout15m: momentum.fakeout15m,
          recentMomentum5m: momentum.recentMomentum5m,
          recentMomentum15m: momentum.recentMomentum15m,
        });
        confidenceBeforeDecay = finalConfidence;
        momentumDecayResult = decay;
        finalConfidence = applyMomentumDecay(
          finalConfidence,
          decay.decayPercent,
        );

        const isBullishAction = action === 'CE-BUY';
        const opposingStructure = getOpposing15mStructure(
          isBullishAction,
          momentum.structureElements,
        );
        const multiFactorDecay =
          decay.reasons.length >= 2 ||
          decay.decayPercent >= veto.OPPOSED_STRUCTURE_DECAY_VETO + 0.05;

        if (!vetoOff) {
          if (
            !vetoRelaxed &&
            finalConfidence < MIN_CONFIDENCE_AFTER_DECAY[tradingStyle]
          ) {
            vetoedByDecay = true;
            action = 'NO-TRADE';
            finalConfidence = 0;
            noteVeto(
              `Confidence after decay (${finalConfidence}) below minimum ${MIN_CONFIDENCE_AFTER_DECAY[tradingStyle]}`,
            );
          } else if (decay.decayPercent >= veto.HARD_DECAY_VETO) {
            vetoedByDecay = true;
            action = 'NO-TRADE';
            finalConfidence = 0;
            noteVeto(
              `Hard decay veto: ${Math.round(decay.decayPercent * 100)}% decay`,
            );
          } else if (
            !vetoRelaxed &&
            opposingStructure.hasAny &&
            decay.decayPercent >= veto.OPPOSED_STRUCTURE_DECAY_VETO &&
            multiFactorDecay
          ) {
            vetoedByDecay = true;
            action = 'NO-TRADE';
            finalConfidence = 0;
            noteVeto(
              `Opposing 15m structure with multi-factor decay (${Math.round(decay.decayPercent * 100)}%)`,
            );
          }
        } else {
          finalConfidence = Math.max(
            finalConfidence,
            MIN_CONFIDENCE_AFTER_DECAY[tradingStyle],
          );
        }
      }

      if (vetoOff) {
        const directional = isBullishPrimary
          ? 'CE-BUY'
          : isBearishPrimary
            ? 'PE-BUY'
            : 'NO-TRADE';
        if (directional !== 'NO-TRADE' && action === 'NO-TRADE') {
          action = directional;
          vetoedByDecay = false;
          finalConfidence = Math.max(
            confidenceBeforeDecay ?? finalConfidence,
            MIN_CONFIDENCE_AFTER_DECAY[tradingStyle],
            TA_CONFIDENCE.MIN_ACTIONABLE,
          );
          entry = primary.lastPrice;
          let rawSl =
            directional === 'CE-BUY'
              ? primary.swings.lows.at(-1)?.price || primary.support || 0
              : primary.swings.highs.at(-1)?.price || primary.resistance || 0;
          stopLoss = rawSl;
          if (
            momentum?.primaryAtr &&
            momentum.primaryAtr > 0 &&
            rawSl > 0
          ) {
            stopLoss = normalizeStopLoss(
              directional,
              entry,
              rawSl,
              momentum.primaryAtr,
            ).stopLoss;
          }
        }
      }

      const liveRisk =
        action === 'CE-BUY'
          ? Math.max(1, entry - stopLoss)
          : action === 'PE-BUY'
            ? Math.max(1, stopLoss - entry)
            : 1;
      const liveRrMultipliers = action === 'NO-TRADE' ? [] : [1.5, 2.5, 4.0];

      const takeProfits = liveRrMultipliers.map((mult, i) => {
        const price =
          action === 'CE-BUY'
            ? +(entry + liveRisk * mult).toFixed(2)
            : +(entry - liveRisk * mult).toFixed(2);
        const decay = 0.15 * i;
        return {
          price,
          rr: rrLabels[i],
          confidence: Math.max(20, Math.round(finalConfidence * (1 - decay))),
        };
      });

      // Strength classification
      let strength: 'HIGH' | 'MEDIUM' | 'LOW' = 'LOW';
      if (finalConfidence >= 72 && aligned >= 2) strength = 'HIGH';
      else if (finalConfidence >= 48) strength = 'MEDIUM';

      // For NO-TRADE, give a weak strength only if close
      if (action === 'NO-TRADE') {
        strength = Math.abs(primaryScore) > 0.25 ? 'LOW' : 'LOW';
      }

      return {
        action,
        entry,
        stopLoss: +stopLoss.toFixed(2),
        takeProfits,
        confidence: action === 'NO-TRADE' ? 0 : finalConfidence,
        strength,
        primaryTimeframe: primaryTf,
        structuralAction,
        confidenceBeforeDecay,
        momentumDecay: momentumDecayResult,
        vetoedByDecay,
        minConfidenceAfterDecay: MIN_CONFIDENCE_AFTER_DECAY[tradingStyle],
        entryVetoReason,
      };
    };

    const calculateATR = (candles: FyersAPI.Candle[], period = 14): number => {
      if (candles.length < period + 1) return 0;

      // Using technicalindicators package (already a project dependency).
      // Cleaner and less error-prone than manual True Range implementation.
      // We could calculate from pure OHLCV if we wanted to avoid the dep,
      // but the lib is the better choice here for standard indicators.
      const high = candles.map((c) => c[2]);
      const low = candles.map((c) => c[3]);
      const close = candles.map((c) => c[4]);

      const atrValues = ATR.calculate({
        period,
        high,
        low,
        close,
      });

      return atrValues[atrValues.length - 1] || 0;
    };

    const calculateADX = (candles: FyersAPI.Candle[], period = 14): number => {
      if (candles.length < period + 1) return 0;

      const high = candles.map((c) => c[2]);
      const low = candles.map((c) => c[3]);
      const close = candles.map((c) => c[4]);

      const adxValues = ADX.calculate({
        period,
        high,
        low,
        close,
      });

      return adxValues[adxValues.length - 1]?.adx || 0;
    };

    // Fair Value Gap detection (3-candle imbalance)
    const detectFairValueGaps = (candles: FyersAPI.Candle[]): Array<{
      index: number;
      type: 'bullish' | 'bearish';
      gapSize: number;
      upper: number;
      lower: number;
    }> => {
      const fvgs: any[] = [];
      for (let i = 2; i < candles.length; i++) {
        const c1 = candles[i - 2];
        const c3 = candles[i];

        // Bullish FVG: c1 high < c3 low (gap between c1 high and c3 low)
        if (c1[2] < c3[3]) {
          const upper = c3[3];
          const lower = c1[2];
          const gapSize = upper - lower;
          if (gapSize > 0) {
            fvgs.push({
              index: i,
              type: 'bullish',
              gapSize,
              upper,
              lower,
            });
          }
        }

        // Bearish FVG: c1 low > c3 high
        if (c1[3] > c3[2]) {
          const upper = c1[3];
          const lower = c3[2];
          const gapSize = upper - lower;
          if (gapSize > 0) {
            fvgs.push({
              index: i,
              type: 'bearish',
              gapSize,
              upper,
              lower,
            });
          }
        }
      }
      return fvgs;
    };

    // Order Block detection (simplified last opposing candle before displacement)
    const detectOrderBlocks = (candles: FyersAPI.Candle[], minDisplacement = 0.3): Array<{
      index: number;
      type: 'bullish' | 'bearish';
      level: number;
      candle: FyersAPI.Candle;
    }> => {
      const obs: any[] = [];
      for (let i = 1; i < candles.length - 1; i++) {
        const prev = candles[i - 1];
        const curr = candles[i];
        const next = candles[i + 1];

        const bodySize = Math.abs(curr[4] - curr[1]);
        const prevBody = Math.abs(prev[4] - prev[1]);
        const displacement = bodySize / (prevBody || 1);

        // Bullish OB: bearish candle followed by strong bullish move
        if (curr[4] < curr[1] && next[4] > next[1] && displacement > minDisplacement) {
          obs.push({
            index: i,
            type: 'bullish',
            level: curr[3], // low of the OB candle
            candle: curr,
          });
        }

        // Bearish OB: bullish candle followed by strong bearish move
        if (curr[4] > curr[1] && next[4] < next[1] && displacement > minDisplacement) {
          obs.push({
            index: i,
            type: 'bearish',
            level: curr[2], // high of the OB candle
            candle: curr,
          });
        }
      }
      return obs.slice(-5); // keep recent ones
    };

    // Previous day high/low (useful for all styles, especially positional)
    const getPreviousDayHighLow = (candles: FyersAPI.Candle[]): { pdHigh: number; pdLow: number } => {
      if (candles.length === 0) return { pdHigh: 0, pdLow: 0 };

      // Group by day (simple timestamp based, assumes sorted)
      const dayMap = new Map<number, number[]>();
      candles.forEach((c) => {
        const day = Math.floor(c[0] / 86400); // rough day bucket
        if (!dayMap.has(day)) dayMap.set(day, []);
        dayMap.get(day)!.push(c[2], c[3]); // highs and lows
      });

      const days = Array.from(dayMap.keys()).sort((a, b) => b - a);
      if (days.length < 2) return { pdHigh: 0, pdLow: 0 };

      const prevDay = days[1];
      const prevValues = dayMap.get(prevDay)!;
      return {
        pdHigh: Math.max(...prevValues),
        pdLow: Math.min(...prevValues),
      };
    };

    const technicalAnalysisPlugin = {
      getSwings,
      getMarketStructure,
      getSupportAndResistance,
      detectBreakout,
      detectFakeout,
      detectRetest,
      volumeScore,
      swingTrendBias,
      detectBOS,
      detectCHOCH,
      detectLiquiditySweep,
      scoreTimeFrameContext,
      getTradeRecommendationFromScore,
      getBiasSignalFromScores,
      getTradeSignal,
      getConfluentTradeSignal,
      computeRangeCompression,
      calculateATR,
      calculateADX,
      detectFairValueGaps,
      detectOrderBlocks,
      getPreviousDayHighLow,
    };

    fastify.decorate('technicalAnalysisPlugin', technicalAnalysisPlugin);
  },
  {
    name: 'technical-analysis',
    dependencies: ['momentum-decay'],
  },
);
