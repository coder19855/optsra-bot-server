import { AdaptiveConvictionInsight } from './adaptive-conviction';
import { AlertWhyContext } from './alert-intelligence';
import { ExactStrikeRecommendation } from './exact-strike-recommendation';
import { GreeksStrikeInsight } from './greeks-strike-insight';
import {
  ChartPatternDirection,
  ChartPatternId,
  PatternStatus,
  RrLabel,
  Timeframe,
  TradeSetup,
} from './technical-analysis';
import { DecisionAction, TradeBias } from './trade-decision';
import { TradingStyle } from './trading-style';

export type PriceActionSignal = 'CE-BUY' | 'PE-BUY' | 'NO-TRADE';

/** Route alerts to different chats — assign per-chat sounds in the Telegram app. */
export type TelegramAlertChannel = 'signal' | 'tp' | 'coach' | 'test' | 'default';

export interface TelegramInlineButton {
  text: string;
  /** Opens in the device browser. */
  url?: string;
  /** Opens the Telegram Mini App (in-chat web view). */
  webAppUrl?: string;
}

export interface TelegramSendOptions {
  channel?: TelegramAlertChannel;
  /** Reply in the chat where the user sent a command (overrides channel routing). */
  chatId?: string | number;
  /** Override env silent flag for this message. */
  disableNotification?: boolean;
  /** URL buttons open in the device browser when tapped. */
  inlineKeyboard?: TelegramInlineButton[][];
  /** Skip journal tracking (e.g. ephemeral clear confirmation). */
  skipMessageTracking?: boolean;
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
  /** Consecutive polls with the same CE/PE action (used for entry confirmation). */
  directionalStreak?: number;
  /** Consecutive polls with NO-TRADE (used for exit confirmation). */
  noTradeStreak?: number;
  /** True while a directional read is waiting for SIGNAL_ENTRY_CONFIRM_POLLS. */
  awaitingEntryConfirmation?: boolean;
  /** True while a CE/PE exit is waiting for SIGNAL_EXIT_CONFIRM_POLLS (flat / no open leg). */
  awaitingExitConfirmation?: boolean;
  /** True while an engaged hard exit waits for NO-TRADE + conviction + decay confirmation. */
  awaitingHardExitConfirmation?: boolean;
  /** True while an engaged opposite-direction exit waits for confirm polls. */
  awaitingOppositeExitConfirmation?: boolean;
  /** Dedupes repeated EDGE_FADE caution alerts for the same fingerprint. */
  lastEdgeFadeFingerprint?: string | null;
  /** Direction held while engaged — set only when a live Fyers open leg exists. */
  engagedDirection?: 'CE-BUY' | 'PE-BUY';
  chartPattern?: ChartPatternId;
  chartPatternStatus?: PatternStatus;
  chartPatternTimeframe?: Timeframe;
  /** Dedupes repeated chart-pattern breakout Telegram alerts. */
  lastNotifiedPatternBreakoutKey?: string | null;
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

export interface TradeStructureContext {
  primaryTimeframe: '5m' | '15m' | '1h';
  primaryScore: number;
  timeframeScores: Record<'5m' | '15m' | '1h', number>;
  enterThreshold: number;
}

export interface TradeDecisionAlertPayload {
  symbol: string;
  tradingStyle: TradingStyle;
  lastPrice: number;
  action: DecisionAction;
  bias: TradeBias;
  conviction: number;
  structureContext?: TradeStructureContext;
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
    /** Chart direction before momentum-decay veto (when action is NO-TRADE). */
    structuralAction?: PriceActionSignal;
    vetoReason?: string;
    confidenceBeforeDecay?: number;
  };
  optionFlow?: {
    bias?: string;
    ivRegime?: string;
    greeksStrikeInsight?: GreeksStrikeInsight;
  };
  recommendedStrategies: RecommendedStrategyAlert[];
  positionSizing?: TelegramPositionSizing;
  exactStrikeRecommendation?: ExactStrikeRecommendation;
  whyContext?: AlertWhyContext;
  adaptiveConviction?: AdaptiveConvictionInsight;
  tradeSetup?: TradeSetup | null;
  momentumDecayPercent?: number | null;
  chartPattern?: {
    pattern: ChartPatternId;
    status?: PatternStatus;
    direction?: ChartPatternDirection;
    neckline?: number;
    timeframe?: Timeframe;
  };
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

  /** Last computed Position Health Score (for trend detection in management brain) */
  lastPositionHealthScore?: number;
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
  /** Rich output from the Management Brain — primary source of truth for what to do with the open position. */
  managementAdvice?: import('../telegram-notifications/position-monitor').ManagementAdvice;
}

export interface TelegramNotificationStatus {
  enabled: boolean;
  configured: boolean;
  /** Inbound /commands restricted to TELEGRAM_ALLOWED_USER_IDS (or TELEGRAM_CHAT_ID). */
  commandAccessRestricted: boolean;
  allowedCommandUsers: number;
  isTokenValid: boolean;
  alertChannels: TelegramAlertChannelConfig[];
  soundRoutingNote: string;
  polling: boolean;
  /** User paused signal + pre-session alerts via /stop (TP/commands still run). */
  alertsPaused: boolean;
  alertsPausedAt: string | null;
  pollIntervalMs: number;
  marketOpen: boolean;
  preSessionLearningWindow: boolean;
  postSessionCoachWindow: boolean;
  watched: Array<{ symbol: string; tradingStyle: TradingStyle }>;
  lastPollAt: string | null;
  lastPollError: string | null;
  lastCoachSummarySessionDate: string | null;
  lastCoachSummaryAt: string | null;
  lastCoachSummaryError: string | null;
  lastLearningBriefSessionDate: string | null;
  lastLearningBriefAt: string | null;
  lastLearningBriefError: string | null;
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
  | 'INITIAL'
  | 'EDGE_FADE'
  | 'HARD_EXIT';

export type SignalAlertTone = 'standard' | 'caution' | 'hard_exit';

export interface SignalChangeResult {
  shouldNotify: boolean;
  kinds: SignalChangeKind[];
  previous: SignalSnapshot | null;
  current: SignalSnapshot;
  alertTone?: SignalAlertTone;
  exitReason?: string | null;
  engagedFlags?: {
    awaitingHardExitConfirmation?: boolean;
    awaitingOppositeExitConfirmation?: boolean;
    lastEdgeFadeFingerprint?: string | null;
  };
}