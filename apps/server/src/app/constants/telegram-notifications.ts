import { FYERS_OPTION_INDEX_SYMBOLS } from './fyers-symbols';
import { TIMELINE_DEFAULTS } from './technical-analysis';
import { TradingStyle } from '../types/trading-style';

export const TELEGRAM_NOTIFICATION_DEFAULTS = {
  COLLECTION: 'signal-snapshots',
  POLL_INTERVAL_MS: 60 * 1000,
  IST_TIMEZONE: TIMELINE_DEFAULTS.IST_TIMEZONE,
  SESSION_OPEN: TIMELINE_DEFAULTS.SESSION_OPEN,
  SESSION_CLOSE: TIMELINE_DEFAULTS.SESSION_CLOSE,
  DEFAULT_SYMBOLS: [FYERS_OPTION_INDEX_SYMBOLS[0].symbol],
  DEFAULT_TRADING_STYLES: [TradingStyle.Intraday],
  /** Skip alerts when conviction is below this on first poll (avoids startup noise). */
  MIN_CONVICTION_FOR_INITIAL_ALERT: 35,
} as const;

export const TELEGRAM_API_BASE = 'https://api.telegram.org';