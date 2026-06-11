import { FastifyInstance } from 'fastify';
import { TELEGRAM_NOTIFICATION_DEFAULTS } from '../constants/telegram-notifications';
import { TradingStyle } from '../types/trading-style';

/** Entry alerts the bot sent — used for TP tracking, not engaged exit policy. */
export interface TradeEntryIntent {
  key: string;
  indexSymbol: string;
  tradingStyle: TradingStyle;
  direction: 'CE-BUY' | 'PE-BUY';
  alertedAt: Date;
}

const memoryIntents = new Map<string, TradeEntryIntent>();

function intentKey(
  indexSymbol: string,
  tradingStyle: TradingStyle,
  direction: 'CE-BUY' | 'PE-BUY',
): string {
  return `${indexSymbol}:${tradingStyle}:${direction}`;
}

export async function recordTradeEntryIntent(
  fastify: FastifyInstance,
  params: {
    indexSymbol: string;
    tradingStyle: TradingStyle;
    direction: 'CE-BUY' | 'PE-BUY';
  },
): Promise<void> {
  const key = intentKey(params.indexSymbol, params.tradingStyle, params.direction);
  const intent: TradeEntryIntent = {
    key,
    indexSymbol: params.indexSymbol,
    tradingStyle: params.tradingStyle,
    direction: params.direction,
    alertedAt: new Date(),
  };
  memoryIntents.set(key, intent);

  const col = fastify.mongo?.db?.collection<TradeEntryIntent>(
    TELEGRAM_NOTIFICATION_DEFAULTS.ENTRY_INTENT_COLLECTION,
  );
  if (!col) return;
  await col.updateOne({ key }, { $set: intent }, { upsert: true });
}

export async function hasRecentTradeEntryIntent(
  fastify: FastifyInstance,
  params: {
    indexSymbol: string;
    tradingStyle: TradingStyle;
    direction: 'CE-BUY' | 'PE-BUY';
    now?: number;
  },
): Promise<boolean> {
  const key = intentKey(params.indexSymbol, params.tradingStyle, params.direction);
  const now = params.now ?? Date.now();
  const windowMs = TELEGRAM_NOTIFICATION_DEFAULTS.ENTRY_INTENT_WINDOW_MS;

  const col = fastify.mongo?.db?.collection<TradeEntryIntent>(
    TELEGRAM_NOTIFICATION_DEFAULTS.ENTRY_INTENT_COLLECTION,
  );
  let intent = memoryIntents.get(key) ?? null;
  if (col) {
    const doc = await col.findOne({ key });
    if (doc) intent = doc;
  }

  if (!intent) return false;
  const age = now - new Date(intent.alertedAt).getTime();
  return age >= 0 && age <= windowMs;
}

export async function pruneExpiredEntryIntents(
  fastify: FastifyInstance,
  now = Date.now(),
): Promise<void> {
  const windowMs = TELEGRAM_NOTIFICATION_DEFAULTS.ENTRY_INTENT_WINDOW_MS;
  for (const [key, intent] of memoryIntents.entries()) {
    if (now - new Date(intent.alertedAt).getTime() > windowMs) {
      memoryIntents.delete(key);
    }
  }

  const col = fastify.mongo?.db?.collection<TradeEntryIntent>(
    TELEGRAM_NOTIFICATION_DEFAULTS.ENTRY_INTENT_COLLECTION,
  );
  if (!col) return;

  const cutoff = new Date(now - windowMs);
  await col.deleteMany({ alertedAt: { $lt: cutoff } });
}