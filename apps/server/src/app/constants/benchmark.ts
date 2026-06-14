/** Default paper capital for benchmark P&L projection (INR). */
export const BENCHMARK_DEFAULT_STARTING_CAPITAL_INR = 500_000;

/** Flip-exit poll cadence during benchmark replay (minutes). Live deck uses 5m. */
export function resolveBenchmarkFlipPollMinutes(): number {
  const raw = Number(process.env.BENCHMARK_FLIP_POLL_MINUTES ?? 5);
  if (!Number.isFinite(raw)) return 5;
  return Math.min(15, Math.max(5, Math.round(raw)));
}