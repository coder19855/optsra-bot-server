import { MomentumDecayResult } from './technical-analysis';

export type TradeBias =
  | 'Strong Bullish'
  | 'Moderate Bullish'
  | 'Neutral'
  | 'Moderate Bearish'
  | 'Strong Bearish';

export type ConflictLevel = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';

export type DecisionAction = 'CE-BUY' | 'PE-BUY' | 'NEUTRAL' | 'NO-TRADE';

export interface ConvictionBonus {
  label: string;
  points: number;
}

export interface TradeDecisionResult {
  bias: TradeBias;
  action: DecisionAction;
  conviction: number;
  /** Style-weighted PA + option mix before alignment bonuses. */
  weightedBaseConviction: number;
  convictionBonuses: ConvictionBonus[];
  recommendation: string;
  humanSummary: string;
  priceConviction: number;
  priceConvictionBeforeDecay?: number;
  momentumDecay?: MomentumDecayResult;
  optionConviction: number;
  alignment: number;
  conflictLevel: ConflictLevel;
  risk: {
    suggestedRiskPercent: number;
    notes: string[];
  };
  reasons: {
    bullish: string[];
    bearish: string[];
    neutral: string[];
  };
  recommendedStrategies: Array<Record<string, unknown>>;
  aiAnalysis?: import('./ai-agent').AIAnalysisResponse;
}