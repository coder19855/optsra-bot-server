import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { FyersAPI } from 'fyers-api-v3';
import { BiasSignal, PriceActionTradeRecommendation, Swing } from '../types';

export default fp(
  async (fastify: FastifyInstance) => {
    const getSwings = (candles: FyersAPI.Candle[]): Swing => {
      const highs = [];
      const lows = [];

      for (let i = 1; i < candles.length - 1; i++) {
        if (
          candles[i][2] > candles[i - 1][2] &&
          candles[i][2] > candles[i + 1][2]
        )
          highs.push({
            index: i,
            price: candles[i][2],
            timestamp: new Date(candles[i][0] * 1000).toLocaleString(),
          });

        if (
          candles[i][3] < candles[i - 1][3] &&
          candles[i][3] < candles[i + 1][3]
        )
          lows.push({
            index: i,
            price: candles[i][3],
            timestamp: new Date(candles[i][0] * 1000).toLocaleString(),
          });
      }

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

      return 0; // neutral
    };

    const getSupportAndResistance = (swings: Swing, lookback = 5) => {
      const highs = swings.highs.slice(-lookback).map((s) => s.price);
      const lows = swings.lows.slice(-lookback).map((s) => s.price);

      if (highs.length === 0 || lows.length === 0) {
        return { support: 0, resistance: Infinity }; // Avoid false breakout signals
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

      if (last[4] > resistance) return 1; // breakout
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
      // Need at least 2 swing highs and 2 swing lows
      if (swings.highs.length < 2 || swings.lows.length < 2) {
        return 0; // not enough structure
      }

      const lastHigh = swings.highs[swings.highs.length - 1].price;
      const prevHigh = swings.highs[swings.highs.length - 2].price;

      const lastLow = swings.lows[swings.lows.length - 1].price;
      const prevLow = swings.lows[swings.lows.length - 2].price;

      const higherHigh = lastHigh > prevHigh;
      const higherLow = lastLow > prevLow;

      const lowerHigh = lastHigh < prevHigh;
      const lowerLow = lastLow < prevLow;

      // Bullish structure: HH + HL
      if (higherHigh && higherLow) {
        return 1;
      }

      // Bearish structure: LH + LL
      if (lowerHigh && lowerLow) {
        return -1;
      }

      // Mixed structure → sideways
      return 0;
    };

    const scoreTimeFrameContext = ({
      structure,
      breakout,
      retest,
      volume,
      fakeout,
      trendBias,
    }: {
      structure: number;
      breakout: number;
      retest: number;
      volume: number;
      fakeout: number;
      trendBias: number;
    }) => {
      return (
        0.35 * structure +
        0.25 * breakout +
        0.15 * retest +
        0.05 * volume +
        0.1 * fakeout +
        0.1 * trendBias
      );
    };

    const getMultiTimeFrameScore = ({
      score5m,
      score15m,
      score1hr,
    }: {
      score5m: number;
      score15m: number;
      score1hr: number;
    }) => {
      return 0.2 * score5m + 0.3 * score15m + 0.5 * score1hr;
    };

    const getTradeRecommendationFromScore = (
      score: number,
    ): PriceActionTradeRecommendation => {
      if (score >= 0.6) return PriceActionTradeRecommendation.BreakoutLong;
      if (score >= 0.3) return PriceActionTradeRecommendation.PullbackLong;
      if (score >= 0.2) return PriceActionTradeRecommendation.ScalpLong;

      // Wider neutral zone
      if (score > -0.2 && score < 0.2)
        return PriceActionTradeRecommendation.AvoidNoise;

      if (score <= -0.2 && score > -0.3)
        return PriceActionTradeRecommendation.ScalpShort;
      if (score <= -0.3 && score > -0.6)
        return PriceActionTradeRecommendation.PullbackShort;

      return PriceActionTradeRecommendation.BreakoutShort;
    };

    const isBullishTransition = (scores: {
      score5m: number;
      score15m: number;
      score1hr: number;
      finalMTF: number;
    }) => {
      const { score5m, score15m, score1hr, finalMTF } = scores;

      const lowerTFBullish = score5m > 0.2 && score15m > 0.2;
      const higherTFBearish = score1hr < -0.2;
      const mtfNeutral = finalMTF > -0.2 && finalMTF < 0.4;

      return lowerTFBullish && higherTFBearish && mtfNeutral;
    };

    const isBearishTransition = (scores: {
      score5m: number;
      score15m: number;
      score1hr: number;
      finalMTF: number;
    }) => {
      const { score5m, score15m, score1hr, finalMTF } = scores;

      const lowerTFBearish = score5m < -0.2 && score15m < -0.2;
      const higherTFBullish = score1hr > 0.2;
      const mtfNeutral = finalMTF > -0.4 && finalMTF < 0.2;

      return lowerTFBearish && higherTFBullish && mtfNeutral;
    };

    // ---- TREND START (IGNITION) -----------------------------------------

    const isBullishTrendStart = (scores: {
      score5m: number;
      score15m: number;
      score1hr: number;
      finalMTF: number;
    }) => {
      const { score5m, score15m, score1hr, finalMTF } = scores;

      return (
        score5m > 0.4 && score15m > 0.4 && score1hr > 0.0 && finalMTF > 0.4
      );
    };

    const isBearishTrendStart = (scores: {
      score5m: number;
      score15m: number;
      score1hr: number;
      finalMTF: number;
    }) => {
      const { score5m, score15m, score1hr, finalMTF } = scores;

      return (
        score5m < -0.4 && score15m < -0.4 && score1hr < 0.0 && finalMTF < -0.4
      );
    };

    // ---- FAKE REVERSAL (LOWER TF FLIPS, HIGHER TF REFUSES) --------------

    const isBullishFakeReversal = (
      scores: {
        score5m: number;
        score15m: number;
        score1hr: number;
        finalMTF: number;
      },
      volumeScore: number,
      fakeoutScore: number,
    ) => {
      const { score5m, score15m, score1hr } = scores;

      return (
        score5m > 0.2 && // 5m shows bounce
        score15m < 0.2 && // 15m not confirming
        score1hr < -0.3 && // 1h still bearish
        volumeScore < 0 && // weak volume
        fakeoutScore <= 0 // no real bear trap
      );
    };

    const isBearishFakeReversal = (
      scores: {
        score5m: number;
        score15m: number;
        score1hr: number;
        finalMTF: number;
      },
      volumeScore: number,
      fakeoutScore: number,
    ) => {
      const { score5m, score15m, score1hr } = scores;

      return (
        score5m < -0.2 &&
        score15m > -0.2 &&
        score1hr > 0.3 &&
        volumeScore < 0 &&
        fakeoutScore <= 0
      );
    };

    // ---- TREND EXHAUSTION -----------------------------------------------

    const isBullishTrendExhaustion = (
      scores: {
        score5m: number;
        score15m: number;
        score1hr: number;
        finalMTF: number;
      },
      volumeScore: number,
    ) => {
      const { score5m, score15m, score1hr } = scores;

      return (
        score1hr > 0.4 && // strong higher-TF uptrend
        score5m < 0.0 && // lower TF rolling over
        score15m < 0.2 &&
        volumeScore < 0 // volume drying up
      );
    };

    const isBearishTrendExhaustion = (
      scores: {
        score5m: number;
        score15m: number;
        score1hr: number;
        finalMTF: number;
      },
      volumeScore: number,
    ) => {
      const { score5m, score15m, score1hr } = scores;

      return (
        score1hr < -0.4 && // strong higher-TF downtrend
        score5m > 0.0 && // lower TF bouncing
        score15m > -0.2 &&
        volumeScore < 0 // volume drying up
      );
    };

    const getBiasSignalFromPatterns = ({
      isBullishTrendStart,
      isBearishTrendStart,
      isBullishTransition,
      isBearishTransition,
      isBullishTrendExhaustion,
      isBearishTrendExhaustion,
      isBullishFakeReversal,
      isBearishFakeReversal,
    }: {
      isBullishTrendStart: boolean;
      isBearishTrendStart: boolean;
      isBullishTransition: boolean;
      isBearishTransition: boolean;
      isBullishTrendExhaustion: boolean;
      isBearishTrendExhaustion: boolean;
      isBullishFakeReversal: boolean;
      isBearishFakeReversal: boolean;
    }): BiasSignal => {
      // Priority 1: Trend Start (strongest signal)
      if (isBullishTrendStart) return BiasSignal.BullishTrendStart;
      if (isBearishTrendStart) return BiasSignal.BearishTrendStart;

      // Priority 2: Transition Shifts
      if (isBullishTransition) return BiasSignal.BullishTransition;
      if (isBearishTransition) return BiasSignal.BearishTransition;

      // Priority 3: Exhaustion (trend weakening)
      if (isBullishTrendExhaustion) return BiasSignal.BullishExhaustion;
      if (isBearishTrendExhaustion) return BiasSignal.BearishExhaustion;

      // Priority 4: Fakeout reversals
      if (isBullishFakeReversal) return BiasSignal.BullishFakeoutReversal;
      if (isBearishFakeReversal) return BiasSignal.BearishFakeoutReversal;

      // Default
      return BiasSignal.Neutral;
    };

    const priceActionPlugin = {
      getSwings,
      getMarketStructure,
      getSupportAndResistance,
      detectBreakout,
      detectFakeout,
      detectRetest,
      volumeScore,
      scoreTimeFrameContext,
      getMultiTimeFrameScore,
      swingTrendBias,
      getTradeRecommendationFromScore,
      isBullishTrendExhaustion,
      isBullishFakeReversal,
      isBullishTrendStart,
      isBullishTransition,
      isBearishTrendExhaustion,
      isBearishFakeReversal,
      isBearishTrendStart,
      isBearishTransition,
      getBiasSignalFromPatterns,
    };

    fastify.decorate('priceActionPlugin', priceActionPlugin);
  },
  {
    name: 'price-action',
  },
);
