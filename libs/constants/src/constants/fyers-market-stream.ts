export const FYERS_MARKET_STREAM_DEFAULTS = {
  INDIA_VIX_SYMBOL: 'NSE:INDIAVIX-INDEX',
  SESSION_CHECK_MS: 30_000,
  AUTO_RECONNECT_TRIES: 8,
  QUOTE_MAX_AGE_MS: 120_000,
  SPOT_RING_MAX_POINTS: 540,
  SPOT_RING_MAX_AGE_MS: 90 * 60 * 1000,
} as const;

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return fallback;
}

function parsePositiveInt(
  raw: string | undefined,
  fallback: number,
): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Disabled in test unless FYERS_WS_ENABLED=true. */
export function resolveFyersWsEnabled(): boolean {
  if (process.env.FYERS_WS_ENABLED === 'true') return true;
  if (process.env.FYERS_WS_ENABLED === 'false') return false;
  return process.env.NODE_ENV !== 'test';
}

export function resolveFyersWsLiteMode(): boolean {
  return parseBool(process.env.FYERS_WS_LITE_MODE, true);
}

export function resolveFyersWsSessionCheckMs(): number {
  return parsePositiveInt(
    process.env.FYERS_WS_SESSION_CHECK_MS,
    FYERS_MARKET_STREAM_DEFAULTS.SESSION_CHECK_MS,
  );
}