import 'fastify';
import { fyersModel, FyersAPI } from 'fyers-api-v3';
import { FastifyMongoObject } from '@fastify/mongodb';
import {
  DirectionBias,
  IndicatorImpact,
  IndicatorKey,
  IndicatorScores,
  Focus,
  RiskLevel,
  RiskManagement,
  Strategy,
  PriceActionTradeRecommendation,
  BiasSignal,
  Swing,
  TradeSignal,
} from './types';

export interface ScoreMetricsResponse {
  score: number;
  message: string;
}

export interface Explanation {
  name: string;
  score: number | null;
  value?: number;
  meaning: string;
  interpretation: string;
  weightage: number;
  focus?: Focus;
}

export interface ScoreComponents {
  oi: number;
  pcr: number;
  skew: number | null;
  iv: number | null;
  pain: number;
  greeks: number | null;
  vix: number;
  trend: number;
}

declare module 'fastify' {
  interface FastifyInstance {
    fyers: fyersModel;
    mongo: FastifyMongoObject;
    utilsPlugin: {
      norm: (x: number, scale?: number) => number;
      interpretRange: (value: number) => string;
      interpretIVRange: (ivScore: number) => string;
      interpretVixRange: (vix: number) => string;
      calcFinalScore: (parts: ScoreComponents) => number;
      mapSignal: (score: number) => TradeSignal;
      detectIvRegime: (
        atmIvScore: number,
        vixScore: number,
        skewScore: number,
      ) => string;
      biasFromScore: (score: number, strong?: number) => DirectionBias;
      getIndicatorBiases: (
        ind: IndicatorScores,
      ) => Record<IndicatorKey, DirectionBias>;
      computeConfidence: (
        indicators: Record<string, Explanation>,
        finalSignal: TradeSignal,
      ) => {
        value: number;
        percent: number;
        matchingWeight: number;
        totalWeight: number;
      };
    };
    metricCalculationPlugin: {
      filterNearbyStrikes: (
        chain: FyersAPI.OptionChainData[],
        spot: number,
        range: number,
      ) => FyersAPI.OptionChainData[];
      calcOiPressure: (
        chain: FyersAPI.OptionChainData[],
        spot: number,
      ) => number;
      calcPcrScore: (chain: FyersAPI.OptionChainData[]) => number;
      calcSkewScore: (chain: FyersAPI.OptionChainData[]) => number | null;
      calcAtmIvScore: (
        chain: FyersAPI.OptionChainData[],
        spot: number,
      ) => number | null;
      calcMaxPainScore: (
        chain: FyersAPI.OptionChainData[],
        spot: number,
      ) => number;
      calcGreeksScore: (
        chain: FyersAPI.OptionChainData[],
        spot: number,
      ) => number | null;
      calcVixScore: (vix: number) => number;
      calcTrendConfirmationScore: (
        chain: FyersAPI.OptionChainData[],
        spotChangePercent: number,
      ) => number;
    };
    strategyMapperPlugin: {
      mapStrategiesWithVix: (
        score: number,
        vix: number,
        indicators: IndicatorScores,
      ) => {
        bias: string;
        strategies: {
          strategy: string;
          risk: RiskLevel;
        }[];
        vixRange: string;
      };
      computeImpactForStrategy: (
        strategy: Strategy,
        indicators: IndicatorScores,
      ) => {
        impact: IndicatorImpact;
        riskScore: number;
      };
    };
    supportResistancePlugin: {
      getSupportResistance: (chain: FyersAPI.OptionChainData[]) => {
        overallSupport: number | null;
        overallResistance: number | null;
        intradaySupport: number | null;
        intradayResistance: number | null;
      };
    };
    explanationPlugin: {
      buildExplanations: (
        components: ScoreComponents,
        vix: number,
      ) => {
        oi: Explanation;
        pcr: Explanation;
        skew: Explanation;
        iv: Explanation;
        pain: Explanation;
        greeks: Explanation;
        vix: Explanation;
        trend: Explanation;
      };
    };
    strategyRiskManagementPlugin: {
      strategyRiskManagement: Record<Strategy, RiskManagement>;
    };
    priceActionPlugin: {
      getSwings: (candles: FyersAPI.Candle[]) => Swing;
      getMarketStructure: (swings: Swing) => number;
      getSupportAndResistance: (
        swings: Swing,
        lookback?: number,
      ) => {
        support: number;
        resistance: number;
      };
      detectBreakout: (
        candles: FyersAPI.Candle[],
        support: number,
        resistance: number,
      ) => number;
      detectFakeout: (
        candles: FyersAPI.Candle[],
        support: number,
        resistance: number,
      ) => number;
      detectRetest: (
        candles: FyersAPI.Candle[],
        support: number,
        resistance: number,
      ) => number;
      volumeScore: (candles: FyersAPI.Candle[]) => number;
      scoreTimeFrameContext: (score: {
        structure: number;
        breakout: number;
        retest: number;
        volume: number;
        fakeout: number;
        trendBias: number;
      }) => number;
      getMultiTimeFrameScore: (score: {
        score5m: number;
        score15m: number;
        score1hr: number;
      }) => number;
      swingTrendBias: (swings: Swing) => number;
      getTradeRecommendationFromScore: (
        score: number,
      ) => PriceActionTradeRecommendation;
      isBullishTransition: (scores: {
        score5m: number;
        score15m: number;
        score1hr: number;
        finalMTF: number;
      }) => boolean;
      isBearishTransition: (scores: {
        score5m: number;
        score15m: number;
        score1hr: number;
        finalMTF: number;
      }) => boolean;
      isBullishTrendStart: (scores: {
        score5m: number;
        score15m: number;
        score1hr: number;
        finalMTF: number;
      }) => boolean;
      isBearishTrendStart: (scores: {
        score5m: number;
        score15m: number;
        score1hr: number;
        finalMTF: number;
      }) => boolean;
      isBullishFakeReversal: (
        scores: {
          score5m: number;
          score15m: number;
          score1hr: number;
          finalMTF: number;
        },
        volumeScore: number,
        fakeoutScore: number,
      ) => boolean;
      isBearishFakeReversal: (
        scores: {
          score5m: number;
          score15m: number;
          score1hr: number;
          finalMTF: number;
        },
        volumeScore: number,
        fakeoutScore: number,
      ) => boolean;
      isBullishTrendExhaustion: (
        scores: {
          score5m: number;
          score15m: number;
          score1hr: number;
          finalMTF: number;
        },
        volumeScore: number,
      ) => boolean;
      isBearishTrendExhaustion: (
        scores: {
          score5m: number;
          score15m: number;
          score1hr: number;
          finalMTF: number;
        },
        volumeScore: number,
      ) => boolean;
      getBiasSignalFromPatterns: (flags: {
        isBullishTrendStart: boolean;
        isBearishTrendStart: boolean;
        isBullishTransition: boolean;
        isBearishTransition: boolean;
        isBullishTrendExhaustion: boolean;
        isBearishTrendExhaustion: boolean;
        isBullishFakeReversal: boolean;
        isBearishFakeReversal: boolean;
      }) => BiasSignal;
    };
  }
}
