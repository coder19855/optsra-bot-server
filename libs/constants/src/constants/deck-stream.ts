export const DECK_STREAM_DEFAULTS = {
  TICK_INTERVAL_MS: 10_000,
  FULL_REFRESH_MS: 180_000,
  HEARTBEAT_MS: 15_000,
} as const;

function parsePositiveInt(
  raw: string | undefined,
  fallback: number,
): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveDeckStreamTickMs(): number {
  return parsePositiveInt(
    process.env.DECK_SSE_TICK_MS,
    DECK_STREAM_DEFAULTS.TICK_INTERVAL_MS,
  );
}

export function resolveDeckStreamFullRefreshMs(): number {
  return parsePositiveInt(
    process.env.DECK_FULL_REFRESH_MS,
    DECK_STREAM_DEFAULTS.FULL_REFRESH_MS,
  );
}

export function resolveDeckSseEnabled(): boolean {
  return process.env.DECK_SSE_ENABLED !== 'false';
}