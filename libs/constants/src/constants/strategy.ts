import {
  PremiumProfile,
  RiskLevel,
  RiskManagement,
  Strategy,
  StrategyDirection,
} from '../types';

export const strategyRisk: Record<Strategy, RiskLevel> = {
  [Strategy.LongCall]: RiskLevel.High,
  [Strategy.BullCallSpread]: RiskLevel.Medium,
  [Strategy.CallRatioBackSpread]: RiskLevel.High,
  [Strategy.SyntheticLong]: RiskLevel.VeryHigh,
  [Strategy.CallDiagonal]: RiskLevel.Medium,
  [Strategy.BullPutSpread]: RiskLevel.Low,
  [Strategy.ShortPut]: RiskLevel.High,
  [Strategy.PutRatioSpread]: RiskLevel.Medium,
  [Strategy.JadeLizard]: RiskLevel.Medium,
  [Strategy.IronCondor]: RiskLevel.Low,
  [Strategy.ShortStraddle]: RiskLevel.VeryHigh,
  [Strategy.ShortStrangle]: RiskLevel.VeryHigh,
  [Strategy.IronButterfly]: RiskLevel.Medium,
  [Strategy.CalendarSpread]: RiskLevel.Low,
  [Strategy.DiagonalSpread]: RiskLevel.Low,
  [Strategy.LongButterfly]: RiskLevel.Low,
  [Strategy.LongStraddle]: RiskLevel.VeryHigh,
  [Strategy.LongStrangle]: RiskLevel.VeryHigh,
  [Strategy.BullishBrokenWingButterfly]: RiskLevel.Low,
  [Strategy.BrokenWingButterfly]: RiskLevel.Low,
  [Strategy.ATMStraddle]: RiskLevel.High,
  [Strategy.LongPut]: RiskLevel.High,
  [Strategy.BearPutSpread]: RiskLevel.Medium,
  [Strategy.PutRatioBackSpread]: RiskLevel.High,
  [Strategy.SyntheticShort]: RiskLevel.VeryHigh,
  [Strategy.BearCallSpread]: RiskLevel.Low,
  [Strategy.ShortCall]: RiskLevel.VeryHigh,
  [Strategy.BearishBrokenWingButterfly]: RiskLevel.Low,
};

export const strategyExecutionHints: Record<Strategy, string> = {
  // ---------------------------------------------------------
  // BULLISH STRATEGIES
  // ---------------------------------------------------------
  [Strategy.LongCall]:
    'Buy 1 lot ATM or slightly ITM CE (0–100 ITM). Nearest weekly expiry.',

  [Strategy.BullCallSpread]:
    'Buy ATM CE, sell OTM CE (+100). 1 lot each. Weekly expiry.',

  [Strategy.CallRatioBackSpread]:
    'Sell 1 ATM CE, buy 2 OTM CEs (+100 and +200). Debit or small credit OK.',

  [Strategy.SyntheticLong]:
    'Buy ATM CE + Sell ATM PE. 1 lot each. Creates futures-like long.',

  [Strategy.CallDiagonal]:
    'Buy next-week ATM CE, sell near-week OTM CE (+100). 1 lot each.',

  [Strategy.BullPutSpread]:
    'Sell OTM PE (−100), buy further OTM PE (−200). 1 lot each.',

  [Strategy.ShortPut]:
    'Sell 1 lot ATM or slightly OTM PE (0 to −100). Only when IV is high.',

  [Strategy.PutRatioSpread]:
    'Sell 1 ATM PE, buy 1–2 OTM PEs (−100/−200). Weekly expiry.',

  [Strategy.JadeLizard]:
    'Sell ATM PE + Sell OTM CE (+100) + Buy far OTM CE (+200). Ensure total credit > call width.',

  [Strategy.BullishBrokenWingButterfly]:
    'Buy ITM CE (−100), sell 2× ATM CEs, buy far OTM CE (+200). 1 lot structure.',

  // ---------------------------------------------------------
  // BEARISH STRATEGIES
  // ---------------------------------------------------------
  [Strategy.LongPut]:
    'Buy 1 lot ATM or slightly ITM PE (0–100 ITM). Nearest weekly expiry.',

  [Strategy.BearPutSpread]: 'Buy ATM PE, sell OTM PE (−100). 1 lot each.',

  [Strategy.PutRatioBackSpread]:
    'Sell 1 ATM PE, buy 2 OTM PEs (−100 and −200). Weekly expiry.',

  [Strategy.SyntheticShort]:
    'Buy ATM PE + Sell ATM CE. 1 lot each. Futures-like short.',

  [Strategy.BearCallSpread]:
    'Sell OTM CE (+100), buy further OTM CE (+200). 1 lot.',

  [Strategy.ShortCall]:
    'Sell 1 lot ATM or slightly OTM CE (0 to +100). Only when IV is high.',

  [Strategy.BearishBrokenWingButterfly]:
    'Buy ITM PE (−100), sell 2× ATM PEs, buy far OTM PE (−200). 1 lot structure.',

  // ---------------------------------------------------------
  // NEUTRAL / RANGE-BOUND STRATEGIES
  // ---------------------------------------------------------
  [Strategy.CalendarSpread]:
    'Sell near-week ATM option, buy next-week ATM option. CE or PE based on liquidity.',

  [Strategy.DiagonalSpread]:
    'Sell near-week OTM option (±100), buy next-week ATM option. CE or PE.',

  [Strategy.LongButterfly]:
    'Buy ITM option (−100), sell 2× ATM options, buy OTM option (+100). CE or PE.',

  [Strategy.ATMStraddle]:
    'Buy 1 lot ATM CE + 1 lot ATM PE. Weekly expiry. Long gamma.',

  [Strategy.LongStraddle]: 'Buy ATM CE + ATM PE. 1 lot each. Weekly expiry.',

  [Strategy.LongStrangle]: 'Buy OTM CE (+100) + OTM PE (−100). Weekly expiry.',

  [Strategy.IronCondor]:
    'Sell OTM CE (+200) + Sell OTM PE (−200), hedge with further OTM wings (+300/−300). 1 lot each.',

  [Strategy.ShortStraddle]: 'Sell ATM CE + ATM PE. 1 lot. Only in high VIX.',

  [Strategy.ShortStrangle]:
    'Sell OTM CE (+200) + Sell OTM PE (−200). 1 lot. High VIX only.',

  [Strategy.IronButterfly]:
    'Sell ATM straddle (CE+PE), hedge with ±200 wings. 1 lot.',

  [Strategy.BrokenWingButterfly]:
    'Sell ATM straddle, buy closer wing on one side (±100) and far wing on the other (±300). Directional bias built in.',
};

export const strategyRiskManagement: Record<Strategy, RiskManagement> = {
  // ---------------------------------------------------------
  // BULLISH STRATEGIES
  // ---------------------------------------------------------
  [Strategy.LongCall]: {
    positionSizing: '1 lot; debit strategies have defined risk.',
    stopLoss: 'Exit if premium drops 25–30% from entry.',
    takeProfit: 'Target 20–40% profit; trail if momentum continues.',
    exitStrategy: 'Exit if price loses trend strength or IV collapses.',
  },

  [Strategy.BullCallSpread]: {
    positionSizing: '1–2 lots; defined risk vertical.',
    stopLoss: 'Exit if spread value drops 30% or lower strike breaks.',
    takeProfit: 'Target 30–50% of max spread value.',
    exitStrategy:
      'Exit if underlying closes below lower strike or IV drops sharply.',
  },

  [Strategy.CallRatioBackSpread]: {
    positionSizing: '1 lot; unlimited downside risk.',
    stopLoss: 'Exit if underlying stays flat and IV contracts.',
    takeProfit: 'Target 40–60% on breakout or IV expansion.',
    exitStrategy: 'Exit if underlying closes below short strike.',
  },

  [Strategy.SyntheticLong]: {
    positionSizing: 'Small size (0.5–1 lot); high gamma exposure.',
    stopLoss: 'Exit if underlying breaks support.',
    takeProfit: 'Trail aggressively; synthetic behaves like futures.',
    exitStrategy: 'Exit before major events due to gamma risk.',
  },

  [Strategy.CallDiagonal]: {
    positionSizing: '1 lot; low risk due to long-dated hedge.',
    stopLoss: 'Exit if short leg goes ITM.',
    takeProfit: 'Target 20–30% on calendar expansion.',
    exitStrategy: 'Exit if IV collapses or skew flips.',
  },

  [Strategy.BullPutSpread]: {
    positionSizing: '1–2 lots; defined risk.',
    stopLoss: 'Exit if loss reaches 1.5× credit.',
    takeProfit: 'Book 40–60% of credit.',
    exitStrategy: 'Exit if underlying closes below short put strike.',
  },

  [Strategy.ShortPut]: {
    positionSizing: 'Very small (0.5 lot); unlimited risk.',
    stopLoss: 'Exit if underlying breaks support.',
    takeProfit: 'Book 40–60% of credit.',
    exitStrategy: 'Exit before events or if IV spikes.',
  },

  [Strategy.PutRatioSpread]: {
    positionSizing: '1 lot; directional bullish skew.',
    stopLoss: 'Exit if underlying falls sharply and long puts explode.',
    takeProfit: 'Target 20–40% on IV expansion.',
    exitStrategy: 'Exit if underlying closes below long put cluster.',
  },

  [Strategy.JadeLizard]: {
    positionSizing: 'Small size; undefined upside risk.',
    stopLoss: 'Exit if underlying rallies strongly and call side expands.',
    takeProfit: 'Book 40–60% of credit.',
    exitStrategy: 'Exit if either short strike is threatened.',
  },

  [Strategy.BullishBrokenWingButterfly]: {
    positionSizing: '1 lot; defined risk.',
    stopLoss: 'Exit if underlying closes below center strike.',
    takeProfit: 'Target 20–40% profit.',
    exitStrategy: 'Exit if trend weakens or IV collapses.',
  },

  // ---------------------------------------------------------
  // BEARISH STRATEGIES
  // ---------------------------------------------------------
  [Strategy.LongPut]: {
    positionSizing: '1 lot; defined risk.',
    stopLoss: 'Exit if premium drops 25–30%.',
    takeProfit: 'Target 20–40% profit.',
    exitStrategy: 'Exit if trend reverses or IV collapses.',
  },

  [Strategy.BearPutSpread]: {
    positionSizing: '1–2 lots; defined risk.',
    stopLoss: 'Exit if spread loses 30% value.',
    takeProfit: 'Target 30–50% of max spread value.',
    exitStrategy: 'Exit if underlying closes above upper strike.',
  },

  [Strategy.PutRatioBackSpread]: {
    positionSizing: '1 lot; unlimited upside risk.',
    stopLoss: 'Exit if underlying stays flat and IV drops.',
    takeProfit: 'Target 40–60% on breakdown.',
    exitStrategy: 'Exit if underlying closes above short strike.',
  },

  [Strategy.SyntheticShort]: {
    positionSizing: 'Small size; behaves like short futures.',
    stopLoss: 'Exit if underlying breaks resistance.',
    takeProfit: 'Trail aggressively.',
    exitStrategy: 'Exit before events due to gamma risk.',
  },

  [Strategy.BearCallSpread]: {
    positionSizing: '1–2 lots; defined risk.',
    stopLoss: 'Exit if loss reaches 1.5× credit.',
    takeProfit: 'Book 40–60% of credit.',
    exitStrategy: 'Exit if underlying closes above short call strike.',
  },

  [Strategy.ShortCall]: {
    positionSizing: 'Tiny size (0.25–0.5 lot); unlimited risk.',
    stopLoss: 'Exit if underlying rallies strongly.',
    takeProfit: 'Book 40–60% of credit.',
    exitStrategy: 'Exit before events; avoid gamma spikes.',
  },

  [Strategy.BearishBrokenWingButterfly]: {
    positionSizing: '1 lot; defined risk.',
    stopLoss: 'Exit if underlying closes above center strike.',
    takeProfit: 'Target 20–40% profit.',
    exitStrategy: 'Exit if IV collapses or trend reverses.',
  },

  // ---------------------------------------------------------
  // NEUTRAL STRATEGIES
  // ---------------------------------------------------------
  [Strategy.CalendarSpread]: {
    positionSizing: '1–2 lots; low risk.',
    stopLoss: 'Exit if short leg goes ITM.',
    takeProfit: 'Target 20–30% on IV expansion.',
    exitStrategy: 'Exit if price breaks range or IV collapses.',
  },

  [Strategy.DiagonalSpread]: {
    positionSizing: '1 lot; low risk.',
    stopLoss: 'Exit if short leg goes ITM.',
    takeProfit: 'Target 20–30%.',
    exitStrategy: 'Exit if price breaks expected range.',
  },

  [Strategy.LongButterfly]: {
    positionSizing: '1–2 lots; defined risk.',
    stopLoss: 'Exit if price moves outside wings.',
    takeProfit: 'Target 1:2 or 1:3 reward.',
    exitStrategy: 'Exit if IV collapses or price accelerates.',
  },

  [Strategy.ATMStraddle]: {
    positionSizing: 'Very small (0.5 lot); high gamma.',
    stopLoss: 'Exit if premium drops 20–25%.',
    takeProfit: 'Target 20–30%; trail aggressively.',
    exitStrategy: 'Exit before events; gamma risk spikes.',
  },

  [Strategy.LongStraddle]: {
    positionSizing: '1 lot; defined risk.',
    stopLoss: 'Exit if premium drops 25–30%.',
    takeProfit: 'Target 20–40%.',
    exitStrategy: 'Exit if IV collapses or price stagnates.',
  },

  [Strategy.LongStrangle]: {
    positionSizing: '1 lot; defined risk.',
    stopLoss: 'Exit if both legs decay 25–30%.',
    takeProfit: 'Target 20–40%.',
    exitStrategy: 'Exit if IV collapses.',
  },

  [Strategy.IronCondor]: {
    positionSizing: '1–2 lots; low risk.',
    stopLoss: 'Exit if loss reaches 1.5× credit.',
    takeProfit: 'Book 40–60% of credit.',
    exitStrategy: 'Exit if price touches short strike or IV spikes.',
  },

  [Strategy.ShortStraddle]: {
    positionSizing: 'Tiny size (0.25–0.5 lot); unlimited risk.',
    stopLoss: 'Exit if either leg doubles in value.',
    takeProfit: 'Book 40–60% of credit.',
    exitStrategy: 'Exit before events; avoid gamma spikes.',
  },

  [Strategy.ShortStrangle]: {
    positionSizing: 'Small size (0.5 lot).',
    stopLoss: 'Exit if either short leg goes ITM.',
    takeProfit: 'Book 40–60% of credit.',
    exitStrategy: 'Exit before events or if IV spikes.',
  },

  [Strategy.IronButterfly]: {
    positionSizing: '1 lot; defined risk.',
    stopLoss: 'Exit if price breaks wings.',
    takeProfit: 'Book 40–60% of credit.',
    exitStrategy: 'Exit if IV collapses or price accelerates.',
  },

  [Strategy.BrokenWingButterfly]: {
    positionSizing: '1 lot; defined risk.',
    stopLoss: 'Exit if price breaks the unprotected side.',
    takeProfit: 'Target 20–40%.',
    exitStrategy: 'Exit if IV collapses or trend invalidates.',
  },
};

export const strategyMeta: Record<
  Strategy,
  { direction: StrategyDirection; premium: PremiumProfile }
> = {
  // BULLISH
  [Strategy.LongCall]: { direction: 'bullish', premium: 'long' },
  [Strategy.BullCallSpread]: { direction: 'bullish', premium: 'vegaNeutral' },
  [Strategy.CallRatioBackSpread]: {
    direction: 'bullish',
    premium: 'long',
  },
  [Strategy.SyntheticLong]: { direction: 'bullish', premium: 'mixed' },
  [Strategy.CallDiagonal]: { direction: 'bullish', premium: 'long' },
  [Strategy.BullPutSpread]: { direction: 'bullish', premium: 'short' },
  [Strategy.ShortPut]: { direction: 'bullish', premium: 'short' },
  [Strategy.PutRatioSpread]: { direction: 'bullish', premium: 'mixed' },
  [Strategy.JadeLizard]: { direction: 'bullish', premium: 'short' },
  [Strategy.BullishBrokenWingButterfly]: {
    direction: 'bullish',
    premium: 'vegaNeutral',
  },

  // BEARISH
  [Strategy.LongPut]: { direction: 'bearish', premium: 'long' },
  [Strategy.BearPutSpread]: { direction: 'bearish', premium: 'vegaNeutral' },
  [Strategy.PutRatioBackSpread]: {
    direction: 'bearish',
    premium: 'long',
  },
  [Strategy.SyntheticShort]: { direction: 'bearish', premium: 'mixed' },
  [Strategy.BearCallSpread]: { direction: 'bearish', premium: 'short' },
  [Strategy.ShortCall]: { direction: 'bearish', premium: 'short' },
  [Strategy.BearishBrokenWingButterfly]: {
    direction: 'bearish',
    premium: 'vegaNeutral',
  },

  // NEUTRAL / RANGE
  [Strategy.CalendarSpread]: { direction: 'neutral', premium: 'long' },
  [Strategy.DiagonalSpread]: { direction: 'neutral', premium: 'long' },
  [Strategy.LongButterfly]: { direction: 'neutral', premium: 'vegaNeutral' },
  [Strategy.ATMStraddle]: { direction: 'neutral', premium: 'long' },
  [Strategy.LongStraddle]: { direction: 'neutral', premium: 'long' },
  [Strategy.LongStrangle]: { direction: 'neutral', premium: 'long' },
  [Strategy.IronCondor]: { direction: 'neutral', premium: 'short' },
  [Strategy.ShortStraddle]: { direction: 'neutral', premium: 'short' },
  [Strategy.ShortStrangle]: { direction: 'neutral', premium: 'short' },
  [Strategy.IronButterfly]: { direction: 'neutral', premium: 'short' },
  [Strategy.BrokenWingButterfly]: {
    direction: 'neutral',
    premium: 'vegaNeutral',
  },
};
