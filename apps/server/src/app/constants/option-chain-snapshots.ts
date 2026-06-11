export const OPTION_CHAIN_SNAPSHOT_DEFAULTS = {
  COLLECTION: 'option-chain-snapshots',
  /** Default bucket size when OPTION_CHAIN_SNAPSHOT_INTERVAL_MINUTES is unset. */
  FLUSH_INTERVAL_MINUTES: 5,
  RETENTION_DAYS: 7,
} as const;

export function resolveOptionChainFlushIntervalMs(): number {
  const raw = process.env.OPTION_CHAIN_SNAPSHOT_INTERVAL_MINUTES?.trim();
  const minutes = raw ? Number(raw) : OPTION_CHAIN_SNAPSHOT_DEFAULTS.FLUSH_INTERVAL_MINUTES;
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return OPTION_CHAIN_SNAPSHOT_DEFAULTS.FLUSH_INTERVAL_MINUTES * 60 * 1000;
  }
  return minutes * 60 * 1000;
}

export function resolveOptionChainRetentionDays(): number {
  const raw = process.env.OPTION_CHAIN_SNAPSHOT_RETENTION_DAYS?.trim();
  const days = raw ? Number(raw) : OPTION_CHAIN_SNAPSHOT_DEFAULTS.RETENTION_DAYS;
  if (!Number.isFinite(days) || days <= 0) {
    return OPTION_CHAIN_SNAPSHOT_DEFAULTS.RETENTION_DAYS;
  }
  return days;
}