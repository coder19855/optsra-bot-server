import { FastifyInstance } from 'fastify';
import { TELEGRAM_NOTIFICATION_DEFAULTS } from '../constants/telegram-notifications';
import { SignalOutcomeRecord } from '../types/alert-intelligence';
import { ExactStrikeRecommendation } from '../types/exact-strike-recommendation';
import { TradeDecisionAlertPayload } from '../types/telegram-notifications';
import { TELEGRAM_MSG_RULE } from './message-layout';
import { getIstSessionClock } from './signal-tracker';

const COLLECTION = 'signal-outcomes';
const WIN_PCT = 8;
const LOSS_PCT = -12;

function collection(fastify: FastifyInstance) {
  return fastify.mongo?.db?.collection<SignalOutcomeRecord>(COLLECTION);
}

function outcomeKey(
  symbol: string,
  tradingStyle: string,
  alertedAt: Date,
): string {
  return `${symbol}:${tradingStyle}:${alertedAt.toISOString()}`;
}

export async function recordSignalOutcome(
  fastify: FastifyInstance,
  payload: TradeDecisionAlertPayload,
  exactStrike: ExactStrikeRecommendation | undefined,
  alertedAt: Date = new Date(),
): Promise<void> {
  if (
    (payload.action !== 'CE-BUY' && payload.action !== 'PE-BUY') ||
    !exactStrike
  ) {
    return;
  }

  const col = collection(fastify);
  if (!col) return;

  const { sessionDate } = getIstSessionClock(
    alertedAt.getTime(),
    TELEGRAM_NOTIFICATION_DEFAULTS.IST_TIMEZONE,
  );

  const record: SignalOutcomeRecord = {
    key: outcomeKey(payload.symbol, payload.tradingStyle, alertedAt),
    symbol: payload.symbol,
    tradingStyle: payload.tradingStyle,
    action: payload.action,
    sessionDate,
    alertedAt,
    entrySpot: payload.lastPrice,
    entryPremium: exactStrike.premium,
    optionSymbol: exactStrike.fyersSymbol,
    strike: exactStrike.strike,
    conviction: payload.conviction,
    lotSize: exactStrike.lotSize,
    status: 'open',
    lastPremium: exactStrike.premium,
    lastSpot: payload.lastPrice,
    pnlPerUnitInr: 0,
    pnlPercent: 0,
    maxPnlPercent: 0,
    minPnlPercent: 0,
    closedAt: null,
    closeReason: null,
    updatedAt: alertedAt,
  };

  await col.insertOne(record);
}

async function fetchOptionPremium(
  fastify: FastifyInstance,
  optionSymbol: string,
): Promise<number | null> {
  try {
    if (!(await fastify.ensureFyersSession())) return null;
    const res = await fastify.fyers.getQuotes({ symbols: [optionSymbol] });
    const quote =
      (res as Record<string, { last_price?: number }>)[optionSymbol] ??
      Object.values(res as Record<string, { last_price?: number }>)[0];
    const ltp = quote?.last_price;
    return typeof ltp === 'number' && ltp > 0 ? ltp : null;
  } catch {
    return null;
  }
}

function applyPnl(record: SignalOutcomeRecord, premium: number, spot: number) {
  const pnlPerUnit = premium - record.entryPremium;
  const pnlPercent =
    record.entryPremium > 0 ? (pnlPerUnit / record.entryPremium) * 100 : 0;

  record.lastPremium = premium;
  record.lastSpot = spot;
  record.pnlPerUnitInr = pnlPerUnit;
  record.pnlPercent = pnlPercent;
  record.maxPnlPercent = Math.max(record.maxPnlPercent ?? 0, pnlPercent);
  record.minPnlPercent = Math.min(record.minPnlPercent ?? 0, pnlPercent);
  record.updatedAt = new Date();
}

function closeRecord(
  record: SignalOutcomeRecord,
  reason: string,
): SignalOutcomeRecord {
  const pct = record.pnlPercent ?? 0;
  let status: SignalOutcomeRecord['status'] = 'flat';
  if (pct >= WIN_PCT) status = 'win';
  else if (pct <= LOSS_PCT) status = 'loss';

  return {
    ...record,
    status,
    closedAt: new Date(),
    closeReason: reason,
    updatedAt: new Date(),
  };
}

export async function updateOpenSignalOutcomes(
  fastify: FastifyInstance,
  params: { symbols: string[]; spotBySymbol: Record<string, number> },
): Promise<number> {
  const col = collection(fastify);
  if (!col) return 0;

  const open = await col.find({ status: 'open' }).toArray();
  let updated = 0;

  for (const record of open) {
    if (!params.symbols.includes(record.symbol)) continue;

    const premium = await fetchOptionPremium(fastify, record.optionSymbol);
    const spot = params.spotBySymbol[record.symbol] ?? record.lastSpot ?? record.entrySpot;
    if (premium == null) continue;

    applyPnl(record, premium, spot);
    await col.updateOne({ key: record.key }, { $set: record });
    updated += 1;
  }

  return updated;
}

export async function closeSessionSignalOutcomes(
  fastify: FastifyInstance,
  sessionDate: string,
): Promise<SignalOutcomeRecord[]> {
  const col = collection(fastify);
  if (!col) return [];

  const open = await col
    .find({ status: 'open', sessionDate })
    .toArray();

  const closed: SignalOutcomeRecord[] = [];
  for (const record of open) {
    const next = closeRecord(record, 'Session close — paper outcome finalized');
    await col.updateOne({ key: record.key }, { $set: next });
    closed.push(next);
  }

  return closed;
}

export async function loadSignalOutcomes(
  fastify: FastifyInstance,
  limit = 20,
): Promise<SignalOutcomeRecord[]> {
  const col = collection(fastify);
  if (!col) return [];

  return col.find({}).sort({ alertedAt: -1 }).limit(limit).toArray();
}

export async function loadClosedSignalOutcomes(
  fastify: FastifyInstance,
  symbol?: string,
  tradingStyle?: string,
): Promise<SignalOutcomeRecord[]> {
  const col = collection(fastify);
  if (!col) return [];

  const query: Record<string, unknown> = {
    status: { $in: ['win', 'loss', 'flat'] },
  };
  if (symbol) query.symbol = symbol;
  if (tradingStyle) query.tradingStyle = tradingStyle;

  return col.find(query).sort({ alertedAt: -1 }).limit(200).toArray();
}

export function formatSignalOutcomesSummary(
  records: SignalOutcomeRecord[],
): string {
  if (!records.length) {
    return '📭 No paper scores yet — they kick in after directional alerts with a strike pick.';
  }

  const lines = ['📊 <b>Paper scoreboard</b>', TELEGRAM_MSG_RULE];

  for (const r of records.slice(0, 8)) {
    const icon =
      r.status === 'win' ? '✅' : r.status === 'loss' ? '❌' : r.status === 'open' ? '⏳' : '➖';
    const pct = r.pnlPercent != null ? `${r.pnlPercent >= 0 ? '+' : ''}${r.pnlPercent.toFixed(1)}%` : '—';
    const when = new Date(r.alertedAt).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
    });
    lines.push(
      `${icon} ${r.action} ${r.strike} @ ${when} · conv ${r.conviction}% · ${pct} ${r.status === 'open' ? '(live)' : ''}`,
    );
  }

  const closed = records.filter((r) => r.status !== 'open');
  if (closed.length) {
    const wins = closed.filter((r) => r.status === 'win').length;
    lines.push(
      '',
      `🏆 Closed alerts: ${wins}/${closed.length} winners (${Math.round((wins / closed.length) * 100)}%)`,
    );
  }

  return lines.join('\n');
}