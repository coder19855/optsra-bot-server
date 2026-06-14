import { RrLabel } from '../types/technical-analysis';

/** Live engine + benchmark RR ladder (matches getConfluentTradeSignal). */
export const LIVE_TRADE_RR_LABELS: RrLabel[] = ['1:1.5', '1:2.5', '1:4'];

export const LIVE_TRADE_RR_MULTIPLIERS = [1.5, 2.5, 4] as const;

export const LIVE_TRADE_RR_ORDER: RrLabel[] = [...LIVE_TRADE_RR_LABELS];

/** Replay flip polls use 5m engine reads (2 polls ≈ 10m confirm window). */
export const FLIP_POLL_INTERVAL_MINUTES = 5;

/** Once past 1:4, trail floor ratchets at peakR − this (e.g. 7R peak → 6R floor). */
export const TRAIL_GIVEBACK_R = 1;