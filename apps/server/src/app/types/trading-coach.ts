import { TradeAction, TradeOutcome, TradeSetup } from './technical-analysis';
import { TradingStyle } from './trading-style';

export type CoachVerdict = 'good' | 'bad' | 'ugly';

export type CoachEntryQuality = 'clean' | 'weak' | 'vetoed' | 'no_signal';

export type CoachExitQuality =
  | 'optimal'
  | 'acceptable'
  | 'early'
  | 'late'
  | 'unknown';

export interface FyersTradeFill {
  tradeNumber: string;
  symbol: string;
  side: 1 | -1;
  tradedQty: number;
  tradePrice: number;
  tradeValue: number;
  orderDateTime: string;
  orderNumber: string;
  productType: string;
  orderTag?: string;
  /** Fyers carry/settlement rows (00:00:00 / NDIR*) — excluded from FIFO coaching replay */
  isInternalCarry?: boolean;
}

export interface CoachSymbolPnl {
  optionSymbol: string;
  indexSymbol: string | null;
  underlying: string | null;
  realizedPnlInr: number;
  buyQty: number;
  sellQty: number;
  buyRate: number;
  sellRate: number;
  hasSessionRoundTrips: boolean;
}

export interface CoachPnlSummary {
  source: 'fyers_realised_profit_history';
  grossPnlInr: number;
  netPnlInr: number;
  chargesInr: number;
  computedRoundTripPnlInr: number;
  reconciled: boolean;
  reconciliationNote?: string;
}

export interface RoundTripTrade {
  id: string;
  optionSymbol: string;
  indexSymbol: string;
  underlying: string;
  optionType: 'CE' | 'PE';
  direction: TradeAction;
  entryAtMs: number;
  exitAtMs: number;
  entryAtISO: string;
  exitAtISO: string;
  sessionDate: string;
  qty: number;
  entryPremium: number;
  exitPremium: number;
  pnlInr: number;
  pnlPremium: number;
  productType: string;
  entryFills: FyersTradeFill[];
  exitFills: FyersTradeFill[];
}

export interface CoachSignalSnapshot {
  asOfMs: number;
  asOfISO: string;
  label: string;
  spot: number;
  signal: {
    action: TradeAction;
    confidence: number;
    strength: string;
    vetoReason?: string;
  };
  timeframeScores: Record<string, number>;
  aligned: number;
  mtfScore: number;
  tradeSetup?: TradeSetup;
  decayPercent?: number;
  vetoedByDecay?: boolean;
}

export interface CoachExcursion {
  mfePoints: number;
  maePoints: number;
  mfeR: number | null;
  maeR: number | null;
  entrySpot: number;
  exitSpot: number;
}

export interface CoachPostExit {
  windowMinutes: number;
  spotMovePoints: number;
  spotMoveR: number | null;
  continuedInFavor: boolean;
  reversedAfterExit: boolean;
}

export interface CoachReplay {
  mode: 'price_action_only';
  note: string;
  preTradeMinutes: number;
  postTradeMinutes: number;
  preTrade: CoachSignalSnapshot[];
  atEntry: CoachSignalSnapshot | null;
  atExit: CoachSignalSnapshot | null;
  expectedOutcome: TradeOutcome | null;
  excursion: CoachExcursion | null;
  postExit: CoachPostExit | null;
}

export interface CoachAnalysis {
  systemApproved: boolean;
  entryQuality: CoachEntryQuality;
  exitQuality: CoachExitQuality;
  verdict: CoachVerdict;
  tags: string[];
  coaching: string[];
}

export interface TradingCoachTradeReport {
  trade: RoundTripTrade;
  tradingStyle: TradingStyle;
  replay: CoachReplay;
  analysis: CoachAnalysis;
}

export interface TradingCoachSummary {
  totalRoundTrips: number;
  analyzed: number;
  skipped: number;
  internalCarryFillsExcluded: number;
  verdicts: Record<CoachVerdict, number>;
  /** Authoritative total from Fyers realised PnL when available */
  totalPnlInr: number;
  /** Sum of FIFO round-trip PnL on session fills only (coaching replay) */
  computedRoundTripPnlInr: number;
  systemApprovedCount: number;
  winCount: number;
  lossCount: number;
}

export type CoachTradeSource = 'fyers_tradebook' | 'fyers_trade_history';

export interface TradingCoachResponse {
  source: CoachTradeSource;
  dateRange: {
    fromDate: string | null;
    toDate: string | null;
  };
  rawFillCount: number;
  disclaimer: string;
  tradingStyle: TradingStyle;
  indexFilter: string | null;
  sessionDateFilter: string | null;
  generatedAt: string;
  summary: TradingCoachSummary;
  pnlSummary: CoachPnlSummary | null;
  symbolPnl: CoachSymbolPnl[];
  trades: TradingCoachTradeReport[];
  skippedTrades: Array<{ reason: string; symbol?: string; entryAtISO?: string }>;
}