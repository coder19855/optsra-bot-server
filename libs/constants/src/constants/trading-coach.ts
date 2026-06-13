import { TradingStyle } from '../types/trading-style';

/** Minutes of PA context captured before entry and after exit. */
export const COACH_DEFAULT_PRE_MINUTES = 45;

export const COACH_DEFAULT_POST_MINUTES = 45;

/** Snapshot offsets (minutes before entry) for pre-trade audit trail. */
export const COACH_PRE_SNAPSHOT_OFFSETS_MIN = [30, 15, 5] as const;

/** Intraday clean-entry bar (aligned with timeline replay). */
export const COACH_CLEAN_ENTRY = {
  MIN_CONFIDENCE: 60,
  STRENGTHS: ['MEDIUM', 'HIGH'] as const,
} as const;

/** Style-specific conviction gates for systemApproved. */
export const COACH_STYLE_ENTER_THRESHOLD: Record<TradingStyle, number> = {
  [TradingStyle.Scalper]: 40,
  [TradingStyle.Intraday]: 60,
  [TradingStyle.Positional]: 62,
};

/** Spot move after exit (in R) that suggests leaving money on table. */
export const COACH_EARLY_EXIT_MISS_R = 0.75;

/** Chased entry if spot already moved this % from pre-window open. */
export const COACH_CHASE_MOVE_PERCENT = 0.45;