import { TradingStyle } from '../types/trading-style';
import { Timeframe } from '../types/technical-analysis';

/** Calendar days of candle history fetched before each timeline anchor. */
export const HISTORY_LOOKBACK_DAYS = 35;

/** Fixed MTF blend used in the live technical-analysis response. */
export const MTF_SCORE_WEIGHTS: Record<Timeframe, number> = {
  '5m': 0.2,
  '15m': 0.3,
  '1h': 0.5,
};

/** Style-aware display weights (decision guidance; MTF score uses fixed weights above). */
export const STYLE_TF_DISPLAY_WEIGHTS: Record<
  TradingStyle,
  Record<Timeframe, number>
> = {
  [TradingStyle.Scalper]: { '5m': 0.5, '15m': 0.3, '1h': 0.2 },
  [TradingStyle.Intraday]: { '5m': 0.2, '15m': 0.3, '1h': 0.5 },
  [TradingStyle.Positional]: { '5m': 0.1, '15m': 0.3, '1h': 0.6 },
};

export const TA_CONFIDENCE = {
  MAX: 95,
  MIN_ACTIONABLE: 10,
  NO_TRADE_PENALTY: 40,
} as const;

export const MIN_CONFIDENCE_AFTER_DECAY: Record<TradingStyle, number> = {
  [TradingStyle.Scalper]: 38,
  [TradingStyle.Intraday]: 45,
  [TradingStyle.Positional]: 50,
};

/** Live deck reads at most this many timeline points (15m ≈ 2 sessions). */
export const DECK_LIVE_TIMELINE = {
  DAYS: 2,
  MAX_POINTS: 48,
} as const;

/** Defaults for /api/technical-analysis/timeline */
export const TIMELINE_DEFAULTS = {
  WINDOW_DAYS: 7,
  INTERVAL_MINUTES: 15,
  MIN_WINDOW_DAYS: 1,
  /** Upper bound for `?days=` — pass 15, 30, 60, etc. up to this value */
  MAX_WINDOW_DAYS: 60,
  MIN_CANDLES_FOR_ANALYSIS: 30,
  IST_TIMEZONE: 'Asia/Kolkata',
  SESSION_OPEN: { hour: 9, minute: 15 },
  SESSION_CLOSE: { hour: 15, minute: 30 },
} as const;

/** Clamp swing-based stops to a sane ATR band for timeline replay. */
export const TIMELINE_STOP_ATR = {
  MIN_MULT: 0.35,
  MAX_MULT: 1.5,
} as const;

/** Step 1: make live price direction matter more than stale structure. */
export const TREND_CONTEXT_SCORING = {
  MOMENTUM_WEIGHT: 0.35,
  TREND_BIAS_BULLISH_BONUS: 0.04,
  TREND_BIAS_BEARISH_PENALTY: 0.12,
  TREND_BIAS_MIXED_PENALTY: 0.06,
} as const;

/** Step 2: chop/compression filters before firing trend trades. */
export const REGIME_FILTERS = {
  CHOP_ADX_THRESHOLD: 18,
  CHOP_MAX_ABS_SCORE: 0.28,
  /** Recent avg range / baseline avg range below this → compression */
  COMPRESSION_RANGE_RATIO: 0.72,
  COMPRESSION_MIN_ABS_SCORE: 0.32,
  OPPOSE_5M_THRESHOLD: 0.2,
  STRONG_15M_MOMENTUM: 0.4,
} as const;

/** Step 2.5 / 3: entry vetoes after decay, structure, and regime checks. */
export const ENTRY_VETO = {
  HARD_DECAY_VETO: 0.3,
  /**
   * Opposing 15m FVG/OB + total decay at or above this → NO-TRADE.
   * Must stay above single FVG/OB penalty (12%) so two factors are required.
   */
  OPPOSED_STRUCTURE_DECAY_VETO: 0.22,
  OPPOSED_STRUCTURE_MIN_SIGNALS: 2,
  /** Soft ADX chop: block only when 15m ADX is very weak AND score is not strong */
  INTRADAY_WEAK_ADX_MAX: 14,
  INTRADAY_WEAK_ADX_MIN_ABS_SCORE: 0.32,
  /** CE blocked outright only when 1h is clearly bearish */
  INTRADAY_1H_CE_BLOCK_BELOW: -0.15,
  INTRADAY_1H_CE_MIN_SCORE15: 0.6,
  INTRADAY_1H_CE_MIN_MOM15: 0.6,
  /** PE blocked near support when price is within this % of support */
  PE_NEAR_SUPPORT_PCT: 0.003,
  /** CE veto when 15m ADX below this and a bearish 15m OB is present */
  INTRADAY_CE_OB_ADX_MAX: 15,
  /** CE veto on primary doji when 15m conviction is below this */
  INTRADAY_CE_DOJI_MIN_SCORE15: 0.5,
} as const;

/** Timeline replay: block same-direction re-entry after any closed trade */
export const SESSION_TRADE_COOLDOWN_MINUTES = 75;

/** Timeline replay: block overlapping same-direction positions in a session */
export const SESSION_OVERLAP_GUARD = {
  ENABLED: true,
} as const;

/** Step 4: candlestick pattern scoring weights (applied in scoreTimeFrameContext) */
export const CANDLESTICK_SCORING = {
  ENABLED_FOR_INTRADAY: true,
} as const;

/** Step 5: chart patterns, volatility regime, session bias, trend quality */
export const CONFLUENCE_ENHANCEMENTS = {
  ENABLED_FOR_INTRADAY: true,
  /** Minimum direction-specific trend quality (0–1) to allow entry */
  MIN_TREND_QUALITY: 0.38,
  /** Midday session requires higher trend quality */
  MIDDAY_MIN_TREND_QUALITY: 0.48,
  /** Chart pattern score boost applied in scoreTimeFrameContext */
  CHART_PATTERN_SCORE_ENABLED: true,
  /** Confidence boost when chart pattern aligns with trade direction */
  ALIGNED_PATTERN_CONFIDENCE_BOOST: 10,
  /** Confidence boost when primary candlestick aligns with trade direction */
  ALIGNED_CANDLESTICK_CONFIDENCE_BOOST: 6,
  /** Extra confidence when primary + 15m candlesticks share direction */
  MULTI_TF_CANDLESTICK_CONFIDENCE_BOOST: 4,
} as const;