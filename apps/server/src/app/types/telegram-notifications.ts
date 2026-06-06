import { DecisionAction, TradeBias } from './trade-decision';
import { TradingStyle } from './trading-style';

export type PriceActionSignal = 'CE-BUY' | 'PE-BUY' | 'NO-TRADE';

export interface SignalSnapshot {
  key: string;
  symbol: string;
  tradingStyle: TradingStyle;
  action: DecisionAction;
  paAction: PriceActionSignal;
  bias: TradeBias;
  conviction: number;
  shouldConsiderTrade: boolean;
  topStrategy: string | null;
  lastPrice: number;
  recommendation: string;
  humanSummary: string;
  fingerprint: string;
  updatedAt: Date;
  lastNotifiedAt?: Date;
  lastNotifiedFingerprint?: string;
}

export interface RecommendedStrategyAlert {
  strategy: string;
  risk?: string;
  confidenceScore?: number;
  reason?: string;
  executionHint?: string;
}

export interface TradeDecisionAlertPayload {
  symbol: string;
  tradingStyle: TradingStyle;
  lastPrice: number;
  action: DecisionAction;
  bias: TradeBias;
  conviction: number;
  recommendation: string;
  humanSummary: string;
  tradeGuidance: {
    shouldConsiderTrade: boolean;
    sizeRecommendation?: string;
    notes?: string;
  };
  priceAction: {
    action: PriceActionSignal;
    confidence: number;
  };
  optionFlow?: {
    bias?: string;
    ivRegime?: string;
  };
  recommendedStrategies: RecommendedStrategyAlert[];
}

export interface TelegramNotificationStatus {
  enabled: boolean;
  configured: boolean;
  polling: boolean;
  pollIntervalMs: number;
  marketOpen: boolean;
  watched: Array<{ symbol: string; tradingStyle: TradingStyle }>;
  lastPollAt: string | null;
  lastPollError: string | null;
  snapshots: Array<{
    key: string;
    action: DecisionAction;
    bias: TradeBias;
    conviction: number;
    shouldConsiderTrade: boolean;
    topStrategy: string | null;
    updatedAt: string;
    lastNotifiedAt: string | null;
  }>;
}

export type SignalChangeKind =
  | 'ACTION'
  | 'PA_SIGNAL'
  | 'BIAS'
  | 'TRADE_READY'
  | 'STRATEGY'
  | 'INITIAL';

export interface SignalChangeResult {
  shouldNotify: boolean;
  kinds: SignalChangeKind[];
  previous: SignalSnapshot | null;
  current: SignalSnapshot;
}