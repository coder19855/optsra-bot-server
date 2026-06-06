export enum Strategy {
  LongCall = 'Long Call',
  BullCallSpread = 'Bull Call Spread',
  CallRatioBackSpread = 'Call Ratio Backspread',
  SyntheticLong = 'Synthetic Long',
  CallDiagonal = 'Call Diagonal',
  BullPutSpread = 'Bull Put Spread',
  ShortPut = 'Short Put',
  PutRatioSpread = 'Put Ratio Spread',
  JadeLizard = 'Jade Lizard',
  IronCondor = 'Iron Condor',
  ShortStraddle = 'Short Straddle',
  ShortStrangle = 'Short Strangle',
  IronButterfly = 'Iron Butterfly',
  CalendarSpread = 'Calendar Spread',
  DiagonalSpread = 'Diagonal Spread',
  LongButterfly = 'Long Butterfly',
  LongStraddle = 'Long Straddle',
  LongStrangle = 'Long Strangle',
  BullishBrokenWingButterfly = 'Bullish Broken Wing Butterfly',
  BrokenWingButterfly = 'Broken Wing Butterfly',
  ATMStraddle = 'ATM Straddle',
  LongPut = 'Long Put',
  BearPutSpread = 'Bear Put Spread',
  PutRatioBackSpread = 'Put Ratio Backspread',
  SyntheticShort = 'Synthetic Short',
  BearCallSpread = 'Bear Call Spread',
  ShortCall = 'Short Call',
  BearishBrokenWingButterfly = 'Bearish Broken Wing Butterfly',
}

export enum RiskLevel {
  Low = 'Low',
  Medium = 'Medium',
  High = 'High',
  VeryHigh = 'Very_High',
  Extreme = 'Extreme',
  Caution = 'Caution',
}

export enum Level {
  High = 'High',
  Moderate = 'Moderate',
  Low = 'Low',
}

export enum Sentiment {
  StrongBullish = 'Strong Bullish',
  ModerateBullish = 'Moderate Bullish',
  Neutral = 'Neutral',
  ModerateBearish = 'Moderate Bearish',
  StrongBearish = 'Strong Bearish',
}

export enum TradeSignal {
  BullishTrade = 'BULLISH_TRADE',
  BearishTrade = 'BEARISH_TRADE',
  NonDirectional = 'NON_DIRECTIONAL',
}

export enum OptionType {
  CE = 'CE',
  PE = 'PE',
}

export enum Focus {
  Intraday = 'Intraday',
  Overall = 'Overall',
}

export type IndicatorKey =
  | 'oi'
  | 'pcr'
  | 'skew'
  | 'iv'
  | 'pain'
  | 'greeks'
  | 'vix'
  | 'trend';

export type Impact = 'positive' | 'negative' | 'neutral';

export type IndicatorImpact = Record<IndicatorKey, Impact>;

export interface IndicatorScores {
  oi: number;
  pcr: number;
  skew: number | null;
  iv: number | null;
  pain: number;
  greeks: number | null;
  vix: number;
  trend: number;
}

export type StrategyDirection = 'bullish' | 'bearish' | 'neutral';
export type PremiumProfile = 'long' | 'short' | 'mixed' | 'vegaNeutral';
export type DirectionBias = 'bullish' | 'bearish' | 'neutral';

export interface StrategyWithRisk {
  strategy: string;
  risk: RiskLevel;
}

export interface RiskManagement {
  positionSizing: string;
  stopLoss: string;
  takeProfit: string;
  exitStrategy: string;
}

export interface OptionMetricsResponse {
  spotSymbol: string;
  spotLtp: number;
  spotLtpChangePercent: number;
  score: number;
  signal: string;
  bias: string;
  ivRegime: string;
  confidence?: { percent: number };
  components?: IndicatorScores;
  strategies?: Array<{
    strategy: string;
    risk: string;
    executionHint?: string;
    riskManagement?: unknown;
    indicatorImpact?: unknown;
  }>;
  explanations?: Record<
    string,
    {
      name?: string;
      score?: number;
      value?: number;
      interpretation?: string;
      meaning?: string;
      weightage?: number;
      focus?: string;
    }
  >;
}