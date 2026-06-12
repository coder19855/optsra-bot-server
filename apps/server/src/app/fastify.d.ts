import 'fastify';
import { fyersModel, FyersAPI } from 'fyers-api-v3';
import type { Db, MongoClient, ObjectId } from 'mongodb';
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
  MomentumDecayInput,
  MomentumDecayResult,
  OptionMetricsResponse,
  CandlestickPatternResult,
  ChartPatternResult,
  SessionBias,
  TrendQuality,
  VolatilityRegime,
  PriceActionResponse,
  TradeDecisionResult,
} from './types';
import { TradingStyle } from './types/trading-style';
import { FyersTrackedMethod } from './constants/fyers-usage';
import { FyersUsageResponse } from './types/fyers-usage';
import { MarketDataCacheStats } from './market-data/market-data-store';
import { MarketStreamStats } from './market-data/fyers-market-stream-manager';
import { LiveQuote } from './market-data/quote-cache';
import {
  TelegramNotificationStatus,
  TelegramSendOptions,
} from './types/telegram-notifications';

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
    /** Initializes the Fyers client from Mongo and returns whether the session is usable. */
    ensureFyersSession: (options?: {
      verifyWithApi?: boolean;
    }) => Promise<boolean>;
    fyersUsage: {
      record: (method: FyersTrackedMethod) => void;
      beginScope: (scope: string) => void;
      endScope: (scope: string) => void;
      getStats: () => FyersUsageResponse;
    };
    marketDataCache: {
      getStats: () => MarketDataCacheStats;
    };
    fyersMarketStream?: {
      isEnabled: () => boolean;
      isConnected: () => boolean;
      getIndexLtp: (symbol: string) => number | null;
      getOptionLtp: (symbol: string) => number | null;
      getSpotSeries: (
        symbol: string,
        maxAgeMs?: number,
      ) => Array<{ t: number; v: number }>;
      getQuote: (symbol: string) => LiveQuote | null;
      getStats: () => MarketStreamStats;
      syncSession: () => Promise<void>;
    };
    mongo?: {
      client: MongoClient;
      ObjectId: typeof ObjectId;
      db?: Db;
    };
    utilsPlugin: {
      norm: (x: number, scale?: number) => number;
      interpretRange: (value: number) => string;
      interpretIVRange: (ivScore: number) => string;
      interpretVixRange: (vix: number) => string;
      calcFinalScore: (
        parts: ScoreComponents,
        style?: TradingStyle,
      ) => number;
      mapSignal: (score: number, style?: TradingStyle) => TradeSignal;
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
      getScoreWeights: (
        style?: TradingStyle,
      ) => Record<keyof ScoreComponents, number>;
      getSignalThreshold: (style?: TradingStyle) => number;
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
        sensitivity?: 'aggressive' | 'normal',
      ) => number;
    };
    strategyMapperPlugin: {
      mapStrategiesWithVix: (
        score: number,
        vix: number,
        indicators: IndicatorScores,
        style?: TradingStyle,
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
    momentumDecayPlugin: {
      computeRecentCandleMomentum: (
        candles: FyersAPI.Candle[],
        lookback?: number,
      ) => number;
      computeMomentumDecay: (input: MomentumDecayInput) => MomentumDecayResult;
      applyMomentumDecay: (
        conviction: number,
        decayPercent: number,
      ) => number;
      countDirectionalStructure: (
        elements: Array<{ type: 'bullish' | 'bearish' }>,
        direction: 'bullish' | 'bearish',
        recentCount?: number,
      ) => number;
    };
    technicalAnalysisPlugin: {
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
      detectBOS: (candles: FyersAPI.Candle[], swings: Swing) => number;
      detectCHOCH: (
        candles: FyersAPI.Candle[],
        swings: Swing,
        trendBias: number,
      ) => number;
      detectLiquiditySweep: (
        candles: FyersAPI.Candle[],
        swings: Swing,
      ) => number;
      scoreTimeFrameContext: (params: {
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
      }) => number;
      getTradeRecommendationFromScore: (
        score: number,
      ) => PriceActionTradeRecommendation;
      getBiasSignalFromScores: (params: {
        score5m: number;
        score15m: number;
        score1h: number;
        structure1h: number;
      }) => BiasSignal;
      getTradeSignal: (params: {
        lastPrice: number;
        biasSignal: BiasSignal;
        score: number;
        swings: Swing;
        volume: number;
        breakout: number;
        tradingStyle: TradingStyle;
      }) => {
        direction: 'CE-BUY' | 'PE-BUY' | 'NO-TRADE';
        entry: number;
        stoploss: number;
        takeProfits: {
          price: number;
          rr: string;
          confidence: number;
        }[];
        rrLevels: string[];
        confidence: number;
      };
      computeRangeCompression: (candles: FyersAPI.Candle[]) => number;
      getConfluentTradeSignal: (params: {
        skipEntryVeto?: boolean;
        entryVetoMode?: import('./types/veto-mode').VetoMode;
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
        action: 'CE-BUY' | 'PE-BUY' | 'NO-TRADE';
        entry: number;
        stopLoss: number;
        takeProfits: {
          price: number;
          rr: string;
          confidence: number;
        }[];
        confidence: number;
        strength: 'HIGH' | 'MEDIUM' | 'LOW';
        primaryTimeframe: '5m' | '15m' | '1h';
        structuralAction: 'CE-BUY' | 'PE-BUY' | 'NO-TRADE';
        confidenceBeforeDecay?: number;
        momentumDecay?: { decayPercent: number; reasons: string[] };
        vetoedByDecay: boolean;
        minConfidenceAfterDecay: number;
        entryVetoReason?: string;
      };
      calculateATR: (candles: FyersAPI.Candle[], period?: number) => number;
      calculateADX: (candles: FyersAPI.Candle[], period?: number) => number;
      detectFairValueGaps: (candles: FyersAPI.Candle[]) => Array<{
        index: number;
        type: 'bullish' | 'bearish';
        gapSize: number;
        upper: number;
        lower: number;
      }>;
      detectOrderBlocks: (
        candles: FyersAPI.Candle[],
        minDisplacement?: number,
      ) => Array<{
        index: number;
        type: 'bullish' | 'bearish';
        level: number;
        candle: FyersAPI.Candle;
      }>;
      getPreviousDayHighLow: (candles: FyersAPI.Candle[]) => {
        pdHigh: number;
        pdLow: number;
      };
      swingTrendBias: (swings: Swing) => number;
    };
    decisionEngine: {
      computeTradeDecision: (
        priceData: PriceActionResponse,
        optionData: OptionMetricsResponse,
        style: TradingStyle,
        options?: import('./plugins/decision-engine').DecisionEngineOptions,
      ) => TradeDecisionResult;
    };
    telegramNotifications: {
      isConfigured: () => boolean;
      isEnabled: () => boolean;
      sendMessage: (text: string, options?: TelegramSendOptions) => Promise<void>;
      pollNow: (options?: boolean | { force?: boolean; coachOnly?: boolean }) => Promise<void>;
      getStatus: () => Promise<TelegramNotificationStatus>;
      isAlertsPaused: () => boolean;
      setAlertsPaused: (paused: boolean) => Promise<void>;
      getVoice: () => import('./types/telegram-voice').TelegramVoice;
      setVoice: (
        voice: import('./types/telegram-voice').TelegramVoice,
      ) => Promise<import('./types/telegram-voice').TelegramVoice>;
      getVetoMode: () => import('./types/veto-mode').VetoMode;
      isVetoOff: () => boolean;
      setVetoMode: (
        vetoMode: import('./types/veto-mode').VetoMode,
      ) => Promise<import('./types/veto-mode').VetoMode>;
      setVetoOff: (vetoOff: boolean) => Promise<boolean>;
      getTradingStyle: () => import('./types/trading-style').TradingStyle;
      setTradingStyle: (
        tradingStyle: import('./types/trading-style').TradingStyle,
      ) => Promise<import('./types/trading-style').TradingStyle>;
      getNewsFeed: () => import('./types/market-news-feed').MarketNewsFeedId;
      setNewsFeed: (
        feedId: import('./types/market-news-feed').MarketNewsFeedId,
      ) => Promise<import('./types/market-news-feed').MarketNewsFeedId>;
      resumeAlertsAfterLogin: () => Promise<boolean>;
      startPolling: () => void;
      stopPolling: () => void;
    };
  }
}