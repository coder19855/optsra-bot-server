export type Timeframe = '5m' | '15m' | '1h';

export type TradeAction = 'CE-BUY' | 'PE-BUY' | 'NO-TRADE';

export type CandlestickPatternId =
  | 'bullish_engulfing'
  | 'bearish_engulfing'
  | 'hammer'
  | 'shooting_star'
  | 'doji'
  | 'none';

export type ChartPatternId =
  | 'double_top'
  | 'double_bottom'
  | 'bull_flag'
  | 'bear_flag'
  | 'triangle_ascending'
  | 'triangle_descending'
  | 'triangle_symmetric'
  | 'range_breakout_bull'
  | 'range_breakout_bear'
  | 'trendline_break_bull'
  | 'trendline_break_bear'
  | 'none';

export type ChartPatternDirection = 'bullish' | 'bearish' | 'neutral';

export interface ChartPatternResult {
  pattern: ChartPatternId;
  direction: ChartPatternDirection;
  scoreBoost: number;
}

export type AtrTrend = 'rising' | 'falling' | 'flat';

export type VolatilitySessionPhase = 'compression' | 'expansion' | 'normal';

export interface VolatilityRegime {
  atrTrend: AtrTrend;
  /** Percentile rank of current ATR vs ~20-session lookback (0–100) */
  atrPercentile: number;
  sessionPhase: VolatilitySessionPhase;
  isDeadMarket: boolean;
}

export type SessionPhase = 'morning' | 'midday' | 'closing';

export interface SessionBias {
  phase: SessionPhase;
  /** Signed session directional lean (−1 to 1) */
  directionalBias: number;
  /** >1 = stricter gates (midday chop) */
  confluenceMultiplier: number;
  label: string;
}

export type TrendQualityLabel = 'strong' | 'moderate' | 'weak' | 'choppy';

export interface TrendQuality {
  bullish: number;
  bearish: number;
  components: {
    adx: number;
    slope15m: number;
    structure: number;
    emaDistance: number;
  };
  label: TrendQualityLabel;
}

export interface ConfluenceContext {
  chartPattern: ChartPatternId;
  volatility: VolatilityRegime;
  session: SessionBias;
  trendQuality: TrendQuality;
}

export type CandlestickDirection = 'bullish' | 'bearish' | 'neutral';

export interface CandlestickPatternResult {
  pattern: CandlestickPatternId;
  direction: CandlestickDirection;
  scoreBoost: number;
}

export type SignalStrength = 'HIGH' | 'MEDIUM' | 'LOW';

export type StructureDirection = 'bullish' | 'bearish' | 'neutral';

export type StructureType = 'bullish' | 'bearish';

export enum PriceActionTradeRecommendation {
  BreakoutLong = 'BREAKOUT_LONG',
  BreakoutShort = 'BREAKOUT_SHORT',
  PullbackLong = 'PULLBACK_LONG',
  PullbackShort = 'PULLBACK_SHORT',
  ScalpLong = 'SCALP_LONG',
  ScalpShort = 'SCALP_SHORT',
  AvoidNoise = 'AVOID_NOISE',
  WaitForSetup = 'WAIT_FOR_SETUP',
}

export enum BiasSignal {
  BullishTrendStart = 'BULLISH_TREND_START',
  BearishTrendStart = 'BEARISH_TREND_START',
  BullishTransition = 'BULLISH_TRANSITION',
  BearishTransition = 'BEARISH_TRANSITION',
  BullishExhaustion = 'BULLISH_EXHAUSTION',
  BearishExhaustion = 'BEARISH_EXHAUSTION',
  BullishFakeoutReversal = 'BULLISH_FAKEOUT_REVERSAL',
  BearishFakeoutReversal = 'BEARISH_FAKEOUT_REVERSAL',
  Neutral = 'NEUTRAL',
}

export interface Swing {
  highs: { index: number; price: number; timestamp: string }[];
  lows: { index: number; price: number; timestamp: string }[];
}

export interface StructureElement {
  type: StructureType;
  index?: number;
}

export interface FvgElement extends StructureElement {
  gapSize?: number;
  upper?: number;
  lower?: number;
}

export interface OrderBlockElement extends StructureElement {
  level?: number;
}

export interface MomentumDecayInput {
  direction: StructureDirection;
  score5m: number;
  score15m: number;
  lastPrice: number;
  resistance: number;
  support: number;
  adx5m: number;
  adx15m: number;
  adx1h: number;
  primaryTF: Timeframe;
  structureElements?: {
    fvg?: Record<string, StructureElement[]>;
    orderBlocks?: Record<string, StructureElement[]>;
  };
  fakeout15m?: number;
  recentMomentum5m?: number;
  recentMomentum15m?: number;
}

export interface MomentumDecayResult {
  decayPercent: number;
  reasons: string[];
}

export interface PriceActionResponse {
  symbol: string;
  lastPrice: number;
  tradingStyle: string;
  primaryTimeframe: string;
  signal: {
    action: TradeAction;
    confidence: number;
    strength: SignalStrength;
    vetoReason?: string;
    structuralAction?: TradeAction;
  };
  candlestick?: {
    primary: CandlestickPatternId;
    '5m'?: CandlestickPatternId;
    '15m'?: CandlestickPatternId;
    '1h'?: CandlestickPatternId;
  };
  tradeSetup?: TradeSetup;
  momentumDecay?: TimelineMomentumDecay;
  confluence: {
    mtfScore: number;
    aligned: number;
    total: number;
    higherTimeframeConfirmation: boolean;
    summary: string;
  };
  levels: {
    support: number;
    resistance: number;
  };
  timeframeScores: Record<Timeframe, number>;
  atr?: Record<Timeframe, number>;
  adx?: Record<Timeframe, number>;
  structureElements?: {
    fvg?: Record<string, FvgElement[]>;
    orderBlocks?: Record<string, OrderBlockElement[]>;
    previousDayHL?: Record<string, { pdHigh: number; pdLow: number }>;
  };
  momentum?: {
    recent?: Record<Timeframe, number>;
    fakeout?: Record<Timeframe, number>;
  };
  confluenceContext?: ConfluenceContext;
}

export type TradeExitStatus =
  | 'NO-TRADE'
  | 'OPEN'
  | 'STOP_LOSS'
  | 'TAKE_PROFIT'
  | 'SESSION_END';

export interface TimelineMomentumDecay {
  decayPercent: number;
  reasons: string[];
  confidenceBefore: number;
  confidenceAfter: number;
  minConfidenceRequired: number;
  structuralAction: TradeAction;
  vetoedByDecay: boolean;
}

export type RrLabel = '1:1' | '1:2' | '1:3';

export interface TradeTakeProfitLevel {
  rr: RrLabel;
  multiplier: number;
  price: number;
}

export interface TradeSetup {
  entry: number;
  stopLoss: number;
  rawStopLoss: number;
  risk: number;
  takeProfits: TradeTakeProfitLevel[];
  atrUsed: number;
  stopAdjusted: boolean;
  stopAdjustReason?: string;
}

export interface TradeOutcome {
  status: TradeExitStatus;
  /** Spot P&L in index points from entry to exit */
  pnl: number;
  /** P&L expressed as multiples of initial risk (R) */
  pnlR: number;
  exitPrice: number;
  exitAt?: number;
  exitAtISO?: string;
  /** Which level closed the trade; OPEN uses highest TP touched if any */
  hitLevel?: RrLabel | 'STOP_LOSS' | 'OPEN' | 'SESSION_END';
  barsHeld: number;
  simulationScope?: 'session' | 'window';
}

export interface TimelinePoint {
  asOf: number;
  asOfISO: string;
  spot: number;
  primaryTimeframe: Timeframe;
  timeframeScores: Record<Timeframe, number>;
  mtfScore: number;
  aligned: number;
  signal: {
    action: TradeAction;
    confidence: number;
    strength: SignalStrength;
    vetoReason?: string;
    structuralAction?: TradeAction;
  };
  candlestick?: {
    primary: CandlestickPatternId;
    '5m'?: CandlestickPatternId;
    '15m'?: CandlestickPatternId;
    '1h'?: CandlestickPatternId;
  };
  momentum: {
    recent: Record<Timeframe, number>;
    adx?: Record<Timeframe, number>;
    fakeout?: Record<Timeframe, number>;
  };
  atr?: Record<Timeframe, number>;
  structureElements?: PriceActionResponse['structureElements'];
  momentumDecay?: TimelineMomentumDecay;
  confluenceContext?: ConfluenceContext;
  levels: {
    support: number;
    resistance: number;
  };
  /** Entry, SL, and RR targets (1:1, 1:2, 1:3) from the signal at this point */
  tradeSetup?: TradeSetup;
  /** Simulated forward outcome on 5m candles until SL, TP, or window end */
  tradeOutcome: TradeOutcome;
  /**
   * Legacy benchmark: raw spot move to window end (ignores SL/TP).
   * Kept for comparison only.
   */
  outcomeVsEnd: {
    pnl: number;
    pnlPercent: number;
  };
}

export interface TechnicalAnalysisTimelineResponse {
  replayMode: 'price_action_only';
  optionFlowNote: string;
  simulation: {
    scope: 'session' | 'window';
    stopModel: 'atr_clamped_swing';
    rrTargets: RrLabel[];
    atrStopBand: { minMult: number; maxMult: number };
    sessionCooldownMinutes?: number;
  };
  symbol: string;
  tradingStyle: string;
  window: {
    from: number;
    to: number;
    fromISO: string;
    toISO: string;
    /** Applied replay window length (after clamping to min/max) */
    days: number;
    /** Value from `?days=` before clamping; omitted when default was used */
    requestedDays?: number;
    maxDays: number;
    minDays: number;
  };
  intervalMinutes: number;
  sessionOnly: boolean;
  summary: {
    totalPoints: number;
    signals: Record<TradeAction, number>;
    avgConfidence: number;
    endSpot: number;
    tradeOutcomes: {
      stopLoss: number;
      takeProfit: Record<RrLabel, number>;
      sessionEnd: number;
      open: number;
      noTrade: number;
    };
    decay: {
      vetoedCount: number;
      avgDecayPercent: number;
    };
    avgPnlR: number;
    totalTrades: number;
    totalPnlR: number;
    winRate: number;
    vetoBreakdown: Record<string, number>;
  };
  points: TimelinePoint[];
}