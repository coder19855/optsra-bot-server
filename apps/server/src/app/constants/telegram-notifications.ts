import { FYERS_OPTION_INDEX_SYMBOLS } from './fyers-symbols';
import { TIMELINE_DEFAULTS } from './technical-analysis';
import { TradingStyle } from '../types/trading-style';

export const TELEGRAM_NOTIFICATION_DEFAULTS = {
  COLLECTION: 'signal-snapshots',
  SESSION_STATE_COLLECTION: 'telegram-session-state',
  POLL_INTERVAL_MS: 60 * 1000,
  IST_TIMEZONE: TIMELINE_DEFAULTS.IST_TIMEZONE,
  SESSION_OPEN: TIMELINE_DEFAULTS.SESSION_OPEN,
  SESSION_CLOSE: TIMELINE_DEFAULTS.SESSION_CLOSE,
  /** Minutes after 15:30 IST to attempt the once-per-day coach summary. */
  POST_SESSION_COACH_WINDOW_MINUTES: 45,
  DEFAULT_SYMBOLS: [FYERS_OPTION_INDEX_SYMBOLS[0].symbol],
  DEFAULT_TRADING_STYLES: [TradingStyle.Intraday],
  /** Skip alerts when conviction is below this on first poll (avoids startup noise). */
  MIN_CONVICTION_FOR_INITIAL_ALERT: 35,
  /** Mongo collection for open-position take-profit alert deduplication. */
  TP_SNAPSHOT_COLLECTION: 'position-tp-snapshots',
  /** Recent system entry alerts used to qualify an open Fyers leg for TP coaching. */
  ENTRY_INTENT_COLLECTION: 'trade-entry-intents',
  ALERT_WHY_CONTEXT_COLLECTION: 'alert-why-context',
  SIGNAL_OUTCOMES_COLLECTION: 'signal-outcomes',
  /** Poll Telegram getUpdates for /why, /outcomes, etc. */
  COMMAND_POLL_INTERVAL_MS: 5 * 1000,
  /** How long after a CE/PE entry alert we still treat a new open leg as intentional. */
  ENTRY_INTENT_WINDOW_MS: 3 * 60 * 60 * 1000,
  /**
   * Fire an "approaching take profit" alert when spot is within this many R
   * of the next engine TP level (index points).
   */
  TP_APPROACH_WITHIN_R: 0.3,
  /** Minimum index points to next TP before an approach alert (avoids noise). */
  TP_APPROACH_MIN_POINTS: 8,
} as const;

export const TELEGRAM_API_BASE = 'https://api.telegram.org';