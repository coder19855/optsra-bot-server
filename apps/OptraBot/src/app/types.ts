export enum ResponseStatus {
  ok = 'ok',
  error = 'error',
}

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

export interface StrategyWithRisk {
  strategy: string;
  risk: RiskLevel;
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

export interface RiskManagement {
  positionSizing: string;
  stopLoss: string;
  takeProfit: string;
  exitStrategy: string;
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

// Strategy meta to drive impact rules
export type StrategyDirection = 'bullish' | 'bearish' | 'neutral';
export type PremiumProfile = 'long' | 'short' | 'mixed' | 'vegaNeutral';
export type DirectionBias = 'bullish' | 'bearish' | 'neutral';
