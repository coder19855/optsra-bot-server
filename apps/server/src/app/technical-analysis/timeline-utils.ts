import { FyersAPI } from 'fyers-api-v3';
import {
  HISTORY_LOOKBACK_DAYS,
  TIMELINE_DEFAULTS,
} from '../constants/technical-analysis';
import { normalizeStopLoss } from './stop-utils';
import {
  RrLabel,
  TradeAction,
  TradeOutcome,
  TradeSetup,
  TradeTakeProfitLevel,
} from '../types/technical-analysis';
import { TradingStyle } from '../types/trading-style';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function parseEpochMs(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n < 10_000_000_000 ? n * 1000 : n;
}

export function toIso(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

/** Binary-search slice: all candles with timestamp <= asOf (seconds). */
export function sliceCandlesUpTo(
  candles: FyersAPI.Candle[],
  asOfSec: number,
): FyersAPI.Candle[] {
  if (candles.length === 0) return [];

  let lo = 0;
  let hi = candles.length - 1;
  let result = -1;

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (candles[mid][0] <= asOfSec) {
      result = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return result >= 0 ? candles.slice(0, result + 1) : [];
}

function getIstMinutes(epochSec: number): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMELINE_DEFAULTS.IST_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(epochSec * 1000));

  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return hour * 60 + minute;
}

export function isNseSession(epochSec: number): boolean {
  const day = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMELINE_DEFAULTS.IST_TIMEZONE,
    weekday: 'short',
  }).format(new Date(epochSec * 1000));

  if (day === 'Sat' || day === 'Sun') return false;

  const mins = getIstMinutes(epochSec);
  const open =
    TIMELINE_DEFAULTS.SESSION_OPEN.hour * 60 +
    TIMELINE_DEFAULTS.SESSION_OPEN.minute;
  const close =
    TIMELINE_DEFAULTS.SESSION_CLOSE.hour * 60 +
    TIMELINE_DEFAULTS.SESSION_CLOSE.minute;

  return mins >= open && mins <= close;
}

export function getIstSessionKey(epochSec: number): string {
  const { y, m, d } = getIstYmd(epochSec);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function getIstYmd(epochSec: number): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMELINE_DEFAULTS.IST_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(epochSec * 1000));

  return {
    y: Number(parts.find((p) => p.type === 'year')?.value ?? 0),
    m: Number(parts.find((p) => p.type === 'month')?.value ?? 0),
    d: Number(parts.find((p) => p.type === 'day')?.value ?? 0),
  };
}

/** NSE session close (15:30 IST) for the IST calendar day of epochSec. */
export function getNseSessionCloseSec(epochSec: number): number {
  const { y, m, d } = getIstYmd(epochSec);
  // 15:30 IST = 10:00 UTC on the same IST calendar date
  return Math.floor(Date.UTC(y, m - 1, d, 10, 0, 0) / 1000);
}

export function resolveSimulationUntilSec(
  asOfSec: number,
  tradingStyle: TradingStyle,
  windowToSec: number,
): { untilSec: number; scope: 'session' | 'window' } {
  if (tradingStyle === TradingStyle.Positional) {
    return { untilSec: windowToSec, scope: 'window' };
  }

  const sessionClose = getNseSessionCloseSec(asOfSec);
  if (sessionClose <= asOfSec) {
    return { untilSec: windowToSec, scope: 'window' };
  }

  return {
    untilSec: Math.min(windowToSec, sessionClose),
    scope: 'session',
  };
}

/** Build timeline anchor timestamps from 5m candles inside the analysis window. */
export function buildTimelineAnchors(
  candles5m: FyersAPI.Candle[],
  windowFromMs: number,
  windowToMs: number,
  intervalMinutes: number,
  sessionOnly: boolean,
): number[] {
  const fromSec = Math.floor(windowFromMs / 1000);
  const toSec = Math.floor(windowToMs / 1000);
  const step = Math.max(5, intervalMinutes);
  const anchors: number[] = [];
  let lastKeptSec = 0;

  for (const candle of candles5m) {
    const ts = candle[0];
    if (ts < fromSec || ts > toSec) continue;
    if (sessionOnly && !isNseSession(ts)) continue;

    if (anchors.length === 0) {
      anchors.push(ts * 1000);
      lastKeptSec = ts;
      continue;
    }

    if (ts - lastKeptSec >= step * 60) {
      anchors.push(ts * 1000);
      lastKeptSec = ts;
    }
  }

  return anchors;
}

export function computeWindow(
  toMs: number,
  days: number,
): { fromMs: number; toMs: number; fetchFromMs: number } {
  const clampedDays = Math.min(
    Math.max(1, days),
    TIMELINE_DEFAULTS.MAX_WINDOW_DAYS,
  );
  const fromMs = toMs - clampedDays * MS_PER_DAY;
  const fetchFromMs = fromMs - HISTORY_LOOKBACK_DAYS * MS_PER_DAY;
  return { fromMs, toMs, fetchFromMs };
}

export function calcOutcomeVsEnd(
  entrySpot: number,
  endSpot: number,
  direction: 1 | -1 | 0 = 1,
): { pnl: number; pnlPercent: number } {
  if (entrySpot <= 0) return { pnl: 0, pnlPercent: 0 };
  const signedMove =
    direction === -1 ? entrySpot - endSpot : endSpot - entrySpot;
  const pnl = +signedMove.toFixed(2);
  const pnlPercent = +((signedMove / entrySpot) * 100).toFixed(3);
  return { pnl, pnlPercent };
}

const RR_LABELS: RrLabel[] = ['1:1', '1:2', '1:3'];
const RR_MULTIPLIERS = [1, 2, 3];

export function buildTradeSetup(
  action: TradeAction,
  entry: number,
  rawStopLoss: number,
  atr: number,
): TradeSetup | undefined {
  if (action === 'NO-TRADE' || entry <= 0 || rawStopLoss <= 0) {
    return undefined;
  }

  const { stopLoss, adjusted, reason } = normalizeStopLoss(
    action,
    entry,
    rawStopLoss,
    atr,
  );

  const risk =
    action === 'CE-BUY'
      ? Math.max(0.01, entry - stopLoss)
      : Math.max(0.01, stopLoss - entry);

  const takeProfits: TradeTakeProfitLevel[] = RR_MULTIPLIERS.map(
    (multiplier, index) => ({
      rr: RR_LABELS[index],
      multiplier,
      price:
        action === 'CE-BUY'
          ? +(entry + risk * multiplier).toFixed(2)
          : +(entry - risk * multiplier).toFixed(2),
    }),
  );

  return {
    entry: +entry.toFixed(2),
    stopLoss: +stopLoss.toFixed(2),
    rawStopLoss: +rawStopLoss.toFixed(2),
    risk: +risk.toFixed(2),
    takeProfits,
    atrUsed: +atr.toFixed(2),
    stopAdjusted: adjusted,
    stopAdjustReason: reason,
  };
}

/** Candles strictly after asOfSec, optionally capped at untilSec. */
export function sliceCandlesAfter(
  candles: FyersAPI.Candle[],
  afterSec: number,
  untilSec?: number,
): FyersAPI.Candle[] {
  if (candles.length === 0) return [];

  let lo = 0;
  let hi = candles.length - 1;
  let start = candles.length;

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (candles[mid][0] > afterSec) {
      start = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }

  if (start >= candles.length) return [];

  if (untilSec === undefined) {
    return candles.slice(start);
  }

  let end = start - 1;
  lo = start;
  hi = candles.length - 1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (candles[mid][0] <= untilSec) {
      end = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return end >= start ? candles.slice(start, end + 1) : [];
}

function signedPnl(
  action: TradeAction,
  entry: number,
  exitPrice: number,
): number {
  if (action === 'CE-BUY') return +(exitPrice - entry).toFixed(2);
  if (action === 'PE-BUY') return +(entry - exitPrice).toFixed(2);
  return 0;
}

function highestTpHitLong(
  high: number,
  takeProfits: TradeTakeProfitLevel[],
): TradeTakeProfitLevel | null {
  for (let i = takeProfits.length - 1; i >= 0; i -= 1) {
    if (high >= takeProfits[i].price) return takeProfits[i];
  }
  return null;
}

function highestTpHitShort(
  low: number,
  takeProfits: TradeTakeProfitLevel[],
): TradeTakeProfitLevel | null {
  for (let i = takeProfits.length - 1; i >= 0; i -= 1) {
    if (low <= takeProfits[i].price) return takeProfits[i];
  }
  return null;
}

/**
 * Replay trade on forward 5m candles.
 * Same-bar SL+TP conflict uses conservative SL-first assumption.
 */
export function simulateTradeOutcome(
  action: TradeAction,
  setup: TradeSetup | undefined,
  forwardCandles: FyersAPI.Candle[],
  simulationScope: 'session' | 'window' = 'window',
): TradeOutcome {
  if (action === 'NO-TRADE' || !setup) {
    return {
      status: 'NO-TRADE',
      pnl: 0,
      pnlR: 0,
      exitPrice: 0,
      barsHeld: 0,
      hitLevel: 'OPEN',
      simulationScope,
    };
  }

  const { entry, stopLoss, risk, takeProfits } = setup;

  if (forwardCandles.length === 0) {
    return {
      status: simulationScope === 'session' ? 'SESSION_END' : 'OPEN',
      pnl: 0,
      pnlR: 0,
      exitPrice: entry,
      hitLevel: simulationScope === 'session' ? 'SESSION_END' : 'OPEN',
      barsHeld: 0,
      simulationScope,
    };
  }

  const withScope = (outcome: TradeOutcome): TradeOutcome => ({
    ...outcome,
    simulationScope,
  });

  for (let i = 0; i < forwardCandles.length; i += 1) {
    const candle = forwardCandles[i];
    const [, , high, low] = candle;
    const tsMs = candle[0] * 1000;

    if (action === 'CE-BUY') {
      if (low <= stopLoss) {
        return withScope({
          status: 'STOP_LOSS',
          pnl: signedPnl(action, entry, stopLoss),
          pnlR: -1,
          exitPrice: stopLoss,
          exitAt: tsMs,
          exitAtISO: toIso(tsMs),
          hitLevel: 'STOP_LOSS',
          barsHeld: i + 1,
        });
      }

      const tpHit = highestTpHitLong(high, takeProfits);
      if (tpHit) {
        return withScope({
          status: 'TAKE_PROFIT',
          pnl: signedPnl(action, entry, tpHit.price),
          pnlR: tpHit.multiplier,
          exitPrice: tpHit.price,
          exitAt: tsMs,
          exitAtISO: toIso(tsMs),
          hitLevel: tpHit.rr,
          barsHeld: i + 1,
        });
      }
    } else {
      if (high >= stopLoss) {
        return withScope({
          status: 'STOP_LOSS',
          pnl: signedPnl(action, entry, stopLoss),
          pnlR: -1,
          exitPrice: stopLoss,
          exitAt: tsMs,
          exitAtISO: toIso(tsMs),
          hitLevel: 'STOP_LOSS',
          barsHeld: i + 1,
        });
      }

      const tpHit = highestTpHitShort(low, takeProfits);
      if (tpHit) {
        return withScope({
          status: 'TAKE_PROFIT',
          pnl: signedPnl(action, entry, tpHit.price),
          pnlR: tpHit.multiplier,
          exitPrice: tpHit.price,
          exitAt: tsMs,
          exitAtISO: toIso(tsMs),
          hitLevel: tpHit.rr,
          barsHeld: i + 1,
        });
      }
    }
  }

  const lastCandle = forwardCandles[forwardCandles.length - 1];
  const exitPrice = lastCandle[4];
  const exitAt = lastCandle[0] * 1000;
  const pnl = signedPnl(action, entry, exitPrice);

  let bestTp: TradeTakeProfitLevel | null = null;
  for (const candle of forwardCandles) {
    const tpHit =
      action === 'CE-BUY'
        ? highestTpHitLong(candle[2], takeProfits)
        : highestTpHitShort(candle[3], takeProfits);
    if (
      tpHit &&
      (!bestTp || tpHit.multiplier > bestTp.multiplier)
    ) {
      bestTp = tpHit;
    }
  }

  const unresolvedStatus =
    simulationScope === 'session' ? 'SESSION_END' : 'OPEN';

  return withScope({
    status: unresolvedStatus,
    pnl,
    pnlR: +(pnl / risk).toFixed(3),
    exitPrice: +exitPrice.toFixed(2),
    exitAt,
    exitAtISO: toIso(exitAt),
    hitLevel:
      simulationScope === 'session'
        ? 'SESSION_END'
        : (bestTp?.rr ?? 'OPEN'),
    barsHeld: forwardCandles.length,
  });
}