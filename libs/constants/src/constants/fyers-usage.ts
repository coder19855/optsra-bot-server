/** Documented Fyers API v3 REST rate limits (verify on myapi.fyers.in/docsv3). */
export const FYERS_API_RATE_LIMITS = {
  PER_SECOND: 10,
  PER_MINUTE: 200,
  PER_DAY: 100_000,
} as const;

/** Methods that hit Fyers HTTP APIs — wrapped for usage tracking. */
export const FYERS_TRACKED_METHODS = [
  'getHistory',
  'getOptionChain',
  'get_funds',
  'get_positions',
  'get_tradebook',
  'get_trade_history',
  'get_realised_profit_history',
  'get_profile',
  'getBalance',
  'getQuotes',
  'getMarketDepth',
  'generate_access_token',
  'logout_user',
  'placeOrder',
  'getOrders',
  'getTransactions',
] as const;

export type FyersTrackedMethod = (typeof FYERS_TRACKED_METHODS)[number];

export const FYERS_USAGE_WARN_MINUTE_PERCENT = 80;
export const FYERS_USAGE_CRITICAL_MINUTE_PERCENT = 95;