import { AIAnalysisResponse } from '../types/ai-agent';
import { RrLabel, TradeSetup } from '../types/technical-analysis';
import { TradingStyle } from '../types/trading-style';
import { FlowMode } from '../types/flow-mode';
import { VetoMode } from '../types/veto-mode';

export type BenchmarkAiMode = 'off' | 'shadow' | 'active';
export type BenchmarkOptionSource = 'snapshot' | 'neutral_fallback';

export interface BenchmarkParams {
  symbol: string;
  tradingStyle: TradingStyle;
  days?: number;
  vetoMode?: VetoMode;
  flowMode?: FlowMode;
  aiMode?: BenchmarkAiMode;
  /** Cap live AI API calls per run (cost control). */
  maxAiCalls?: number;
  sessionOnly?: boolean;
  intervalMinutes?: number;
  toMs?: number;
  /** Cap entries per session day; omit for unlimited. */
  maxTradesPerDay?: number;
  /** Exit at market when 1:1.5+ is locked and opposite engine confirms (2 polls). */
  signalFlipExit?: boolean;
  /** Paper starting capital in INR (default ₹5L). */
  startingCapitalInr?: number;
  /** Override risk % per trade for capital projection. */
  riskPercentPerTrade?: number;
}

export interface BenchmarkCapitalSummary {
  startingCapitalInr: number;
  endingCapitalInr: number;
  netPnlInr: number;
  netPnlPercent: number;
  riskPercentPerTrade: number;
  compounding: boolean;
  maxDrawdownInr: number;
  maxDrawdownPercent: number;
  maxDrawdownR: number;
  note: string;
}

export interface BenchmarkTradeRow {
  signalAtMs: number;
  signalAtISO: string;
  sessionDate: string;
  action: 'CE-BUY' | 'PE-BUY';
  indexEntry: number;
  indexExit: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  takeProfit3: number;
  setup: TradeSetup;
  exitStatus: 'STOP_LOSS' | 'TAKE_PROFIT' | 'SESSION_END' | 'OPEN';
  hitLevel:
    | RrLabel
    | 'STOP_LOSS'
    | 'SESSION_END'
    | 'OPEN'
    | 'SIGNAL_FLIP'
    | 'TRAIL_FLOOR';
  pnlPoints: number;
  pnlR: number;
  pnlPercent: number;
  /** INR P&L using compounding risk budget × R. */
  pnlInr?: number;
  riskBudgetInr?: number;
  barsHeld: number;
  conviction: number;
  convictionWithAi?: number;
  optionSource: BenchmarkOptionSource;
  engineVerdict: string;
  aiAnalysis?: AIAnalysisResponse;
  aiVerdictSummary?: string;
}

export interface BenchmarkVariantSummary {
  label: string;
  totalSignals: number;
  wins: number;
  losses: number;
  flats: number;
  winRate: number;
  avgPnlR: number;
  totalPnlR: number;
  avgPnlPercent: number;
  stopLossCount: number;
  takeProfitCounts: Record<'1:1.5' | '1:2.5' | '1:4', number>;
  sessionEndCount: number;
  signalFlipCount: number;
  trailFloorCount: number;
}

export interface BenchmarkAiComparison {
  baseline: BenchmarkVariantSummary;
  withAi: BenchmarkVariantSummary | null;
  aiAgreeOnWins: number;
  aiAgreeOnLosses: number;
  aiDisagreeOnWins: number;
  aiDisagreeOnLosses: number;
  notes: string[];
}

export interface BenchmarkReport {
  params: BenchmarkParams & {
    days: number;
    intervalMinutes: number;
    enterThreshold: number;
  };
  simulationNote: string;
  optionFlowNote: string;
  aiComparison: BenchmarkAiComparison;
  trades: BenchmarkTradeRow[];
  equityCurve: Array<{ t: number; cumulativeR: number; label: string }>;
  capitalSummary: BenchmarkCapitalSummary;
  capitalCurve: Array<{
    t: number;
    capitalInr: number;
    pnlInr: number;
    label: string;
  }>;
  stopLossNote: string;
  generatedAt: string;
}