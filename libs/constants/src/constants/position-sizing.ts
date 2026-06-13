import { TradingStyle } from '../types/trading-style';

/** Default account risk % per trade by style (of available balance). */
export const POSITION_SIZING_DEFAULTS = {
  MIN_RISK_PERCENT: 0.25,
  MAX_RISK_PERCENT: 2.5,
  DEFAULT_DELTA: 0.5,
  /** Cap deployable capital per trade (margin) as % of available balance */
  MAX_CAPITAL_UTILIZATION_PERCENT: 25,
  RISK_BY_STYLE: {
    [TradingStyle.Scalper]: 0.75,
    [TradingStyle.Intraday]: 1,
    [TradingStyle.Positional]: 1.5,
  } as Record<TradingStyle, number>,
  TIER_MULTIPLIERS: {
    conservative: 0.5,
    standard: 1,
    aggressive: 1.5,
  },
} as const;