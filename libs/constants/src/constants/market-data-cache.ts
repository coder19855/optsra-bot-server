export const MARKET_DATA_CACHE_DEFAULTS = {
  CANDLE_TTL_5M_MS: 60_000,
  CANDLE_TTL_HIGHER_MS: 300_000,
  OPTION_CHAIN_TTL_MS: 90_000,
  LIVE_HISTORY_TOLERANCE_MS: 120_000,
} as const;

function parsePositiveInt(
  raw: string | undefined,
  fallback: number,
): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveCandleCacheTtl5mMs(): number {
  return parsePositiveInt(
    process.env.CANDLE_CACHE_TTL_5M_MS,
    MARKET_DATA_CACHE_DEFAULTS.CANDLE_TTL_5M_MS,
  );
}

export function resolveCandleCacheTtlHigherMs(): number {
  return parsePositiveInt(
    process.env.CANDLE_CACHE_TTL_15M_MS,
    MARKET_DATA_CACHE_DEFAULTS.CANDLE_TTL_HIGHER_MS,
  );
}

export function resolveOptionChainCacheTtlMs(): number {
  return parsePositiveInt(
    process.env.OPTION_CHAIN_REST_REFRESH_MS,
    MARKET_DATA_CACHE_DEFAULTS.OPTION_CHAIN_TTL_MS,
  );
}