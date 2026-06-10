import { RrLabel, TradeSetup } from './technical-analysis';
import { DecisionAction, TradeBias } from './trade-decision';
import { TradingStyle } from './trading-style';

export type PriceActionSignal = 'CE-BUY' | 'PE-BUY' | 'NO-TRADE';

/** Route alerts to different chats — assign per-chat sounds in the Telegram app. */
export type TelegramAlertChannel = 'signal' | 'tp' | 'coach' | 'test' | 'default';

export interface TelegramSendOptions {
  channel?: TelegramAlertChannel;
  /** Override env silent flag for this message. */
  disableNotification?: boolean;
}

export interface TelegramAlertChannelConfig {
  channel: TelegramAlertChannel;
  chatIdConfigured: boolean;
  usesDedicatedChat: boolean;
  silentByDefault: boolean;
}

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

export interface TelegramPositionSizingTier {
  label: 'conservative' | 'standard' | 'aggressive';
  lots: number;
  capitalAtRiskInr: number;
  marginRequiredInr: number | null;
}

export interface TelegramPositionSizing {
  availableBalance: number | null;
  totalBalance: number | null;
  lotSize: number;
  indexLabel: string;
  riskPercent?: number;
  riskPoints?: number;
  riskBudgetInr?: number;
  riskPerLotInr?: number;
  recommendedLots?: number;
  maxLotsByRisk?: number;
  maxLotsByMargin?: number | null;
  capitalAtRiskInr?: number;
  marginRequiredInr?: number | null;
  utilizationPercent?: number | null;
  atmStrike?: number | null;
  atmPremium?: number | null;
  optionSide?: 'CE' | 'PE' | null;
  tiers?: TelegramPositionSizingTier[];
  notes?: string[];
  unavailableReason?: string;
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
  positionSizing?: TelegramPositionSizing;
}

export type TpAlertKind =
  | 'APPROACHING'
  | 'REACHED'
  | 'HOLD_REVIEW'
  | 'SIGNAL_CONFLICT';

export type TpHoldAdvice = 'hold' | 'partial' | 'trail' | 'exit';

export type TpTrackReason =
  | 'entry_alert'
  | 'live_aligned'
  | 'already_tracked'
  | null;

export interface TpMonitorSnapshot {
  key: string;
  positionSymbol: string;
  isTracked: boolean;
  trackReason: TpTrackReason;
  highestTpRr: RrLabel | null;
  approachingTpRr: RrLabel | null;
  lastHoldAdvice: TpHoldAdvice | null;
  lastAlertKind: TpAlertKind | null;
  updatedAt: Date;
  trackedAt?: Date;
  lastNotifiedAt?: Date;
}

export interface OpenPositionMonitorContext {
  symbol: string;
  optionLabel: string;
  indexSymbol: string;
  indexLabel: string;
  direction: 'CE-BUY' | 'PE-BUY';
  netQty: number;
  buyAvg: number;
  unrealizedPnl: number;
}

export interface PositionTpEvaluation {
  position: OpenPositionMonitorContext;
  tradingStyle: TradingStyle;
  spot: number;
  tradeSetup: TradeSetup;
  signalAction: DecisionAction;
  paAction: PriceActionSignal;
  bias: TradeBias;
  conviction: number;
  momentumDecayPercent: number | null;
  currentR: number;
  highestHitTp: { rr: RrLabel; price: number; multiplier: number } | null;
  nextTp: { rr: RrLabel; price: number; multiplier: number } | null;
  distanceToNextPoints: number | null;
  distanceToNextR: number | null;
  alertKind: TpAlertKind;
  holdAdvice: TpHoldAdvice;
  holdHeadline: string;
  holdReasons: string[];
}

export interface TelegramNotificationStatus {
  enabled: boolean;
  configured: boolean;
  alertChannels: TelegramAlertChannelConfig[];
  soundRoutingNote: string;
  polling: boolean;
  pollIntervalMs: number;
  marketOpen: boolean;
  postSessionCoachWindow: boolean;
  watched: Array<{ symbol: string; tradingStyle: TradingStyle }>;
  lastPollAt: string | null;
  lastPollError: string | null;
  lastCoachSummarySessionDate: string | null;
  lastCoachSummaryAt: string | null;
  lastCoachSummaryError: string | null;
  openPositionsMonitored: number;
  openPositionsTracked: number;
  lastTpAlertAt: string | null;
  tpSnapshots: Array<{
    positionSymbol: string;
    isTracked: boolean;
    trackReason: TpTrackReason;
    highestTpRr: RrLabel | null;
    approachingTpRr: RrLabel | null;
    lastHoldAdvice: TpHoldAdvice | null;
    lastAlertKind: TpAlertKind | null;
    trackedAt: string | null;
    lastNotifiedAt: string | null;
  }>;
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