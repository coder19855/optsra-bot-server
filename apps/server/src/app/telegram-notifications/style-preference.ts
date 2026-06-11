import { FastifyInstance } from 'fastify';
import { TELEGRAM_NOTIFICATION_DEFAULTS } from '../constants/telegram-notifications';
import { TradingStyle } from '../types/trading-style';
import { parseTradingStyleArg } from './command-args';

const STYLE_PREFERENCE_KEY = 'trading-style-preference';

export interface StylePreferenceState {
  tradingStyle: TradingStyle;
}

export function normalizeTradingStyle(value: unknown): TradingStyle {
  if (typeof value === 'string') {
    const parsed = parseTradingStyleArg(value);
    if (parsed) return parsed;
  }
  return TradingStyle.Intraday;
}

export async function loadStylePreference(
  fastify: FastifyInstance,
  memoryState: StylePreferenceState,
): Promise<StylePreferenceState> {
  const col = fastify.mongo?.db?.collection<
    StylePreferenceState & { key: string }
  >(TELEGRAM_NOTIFICATION_DEFAULTS.SESSION_STATE_COLLECTION);
  if (!col) return memoryState;

  const doc = await col.findOne({ key: STYLE_PREFERENCE_KEY });
  if (doc?.tradingStyle == null) return memoryState;

  return { tradingStyle: normalizeTradingStyle(doc.tradingStyle) };
}

export async function saveStylePreference(
  fastify: FastifyInstance,
  _memoryState: StylePreferenceState,
  tradingStyle: TradingStyle,
): Promise<StylePreferenceState> {
  const next: StylePreferenceState = {
    tradingStyle: normalizeTradingStyle(tradingStyle),
  };

  const col = fastify.mongo?.db?.collection<
    StylePreferenceState & { key: string }
  >(TELEGRAM_NOTIFICATION_DEFAULTS.SESSION_STATE_COLLECTION);
  if (col) {
    await col.updateOne(
      { key: STYLE_PREFERENCE_KEY },
      { $set: { key: STYLE_PREFERENCE_KEY, ...next } },
      { upsert: true },
    );
  }

  return next;
}