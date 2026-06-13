import { LiveQuote } from './quote-cache';

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function tickFromRecord(
  symbol: string,
  row: Record<string, unknown>,
  nowMs: number,
): LiveQuote | null {
  const ltp =
    num(row.ltp) ??
    num(row.last_price) ??
    num(row.lp) ??
    num(row.cmd) ??
    null;
  if (ltp == null || ltp <= 0) return null;

  const ch =
    num(row.ch) ??
    num(row.ltpch) ??
    num(row.change) ??
    num(row.chg) ??
    0;
  const chp =
    num(row.chp) ??
    num(row.ltpchp) ??
    num(row.change_percent) ??
    num(row.chgchp) ??
    0;

  return {
    symbol,
    ltp,
    ch,
    chp,
    updatedAt: nowMs,
    source: 'ws',
  };
}

function parseSingleObject(
  row: Record<string, unknown>,
  nowMs: number,
): LiveQuote | null {
  const symbol = str(row.symbol) ?? str(row.n);
  if (!symbol) return null;
  return tickFromRecord(symbol, row, nowMs);
}

/**
 * Fyers data socket payloads vary (single object, array, or symbol-keyed map).
 */
export function parseWsTicks(message: unknown, nowMs = Date.now()): LiveQuote[] {
  if (message == null) return [];

  if (Array.isArray(message)) {
    const ticks: LiveQuote[] = [];
    for (const item of message) {
      if (item && typeof item === 'object') {
        const tick = parseSingleObject(item as Record<string, unknown>, nowMs);
        if (tick) ticks.push(tick);
      }
    }
    return ticks;
  }

  if (typeof message !== 'object') return [];

  const obj = message as Record<string, unknown>;

  if (typeof obj.symbol === 'string' || typeof obj.n === 'string') {
    const tick = parseSingleObject(obj, nowMs);
    return tick ? [tick] : [];
  }

  const ticks: LiveQuote[] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (!value || typeof value !== 'object') continue;
    if (key === 'type' || key === 's' || key === 'code') continue;
    const row = value as Record<string, unknown>;
    const symbol = str(row.symbol) ?? str(row.n) ?? key;
    const tick = tickFromRecord(symbol, row, nowMs);
    if (tick) ticks.push(tick);
  }

  return ticks;
}