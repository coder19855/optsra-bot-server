import { FastifyInstance } from 'fastify';
import { TELEGRAM_NOTIFICATION_DEFAULTS } from '../constants/telegram-notifications';
import { TradingStyle } from '../types/trading-style';
import { buildLearningInsightProfile } from './learning-insights';
import { formatLearningTelegramMessage } from './learning-formatter';
import {
  fetchMarketNewsHeadlines,
  isMarketNewsEnabled,
} from './market-news';
import { getIstSessionClock } from './signal-tracker';

export interface SessionLearningState {
  lastSessionDate: string | null;
  lastSentAt: Date | null;
  lastError: string | null;
}

export function isPreSessionLearningEnabled(): boolean {
  return (
    (process.env.TELEGRAM_PRE_SESSION_LEARNING_ENABLED ?? 'true').toLowerCase() !==
    'false'
  );
}

export async function loadSessionLearningState(
  fastify: FastifyInstance,
  memoryState: SessionLearningState,
): Promise<SessionLearningState> {
  const col = fastify.mongo?.db?.collection<
    SessionLearningState & { key: string }
  >(TELEGRAM_NOTIFICATION_DEFAULTS.SESSION_STATE_COLLECTION);
  if (!col) return memoryState;

  const doc = await col.findOne({ key: 'learning-preamble' });
  if (!doc) return memoryState;

  return {
    lastSessionDate: doc.lastSessionDate ?? null,
    lastSentAt: doc.lastSentAt ? new Date(doc.lastSentAt) : null,
    lastError: doc.lastError ?? null,
  };
}

export async function saveSessionLearningState(
  fastify: FastifyInstance,
  memoryState: SessionLearningState,
  update: Partial<SessionLearningState>,
): Promise<SessionLearningState> {
  const next: SessionLearningState = {
    lastSessionDate: update.lastSessionDate ?? memoryState.lastSessionDate,
    lastSentAt: update.lastSentAt ?? memoryState.lastSentAt,
    lastError: update.lastError ?? memoryState.lastError,
  };

  const col = fastify.mongo?.db?.collection<
    SessionLearningState & { key: string }
  >(TELEGRAM_NOTIFICATION_DEFAULTS.SESSION_STATE_COLLECTION);
  if (col) {
    await col.updateOne(
      { key: 'learning-preamble' },
      { $set: { key: 'learning-preamble', ...next } },
      { upsert: true },
    );
  }

  return next;
}

export function shouldIncludeNewsInLearning(text: string): boolean {
  return text.toLowerCase().includes('news');
}

export async function buildLearningTelegramMessage(
  fastify: FastifyInstance,
  params: {
    text?: string;
    watchedSymbols: string[];
    watchedStyles: TradingStyle[];
    preamble?: boolean;
    includeNews?: boolean;
  },
): Promise<{ message: string; error?: string }> {
  const sessionReady = await fastify.ensureFyersSession({ verifyWithApi: true });
  if (!sessionReady) {
    return {
      message: '',
      error:
        'Fyers session’s asleep — log in to read your trade history.',
    };
  }

  const { sessionDate } = getIstSessionClock(
    Date.now(),
    TELEGRAM_NOTIFICATION_DEFAULTS.IST_TIMEZONE,
  );

  const includeNews =
    params.includeNews ??
    (params.text ? shouldIncludeNewsInLearning(params.text) : false);

  const profile = await buildLearningInsightProfile(fastify, {
    watchedSymbols: params.watchedSymbols,
    watchedStyles: params.watchedStyles,
    commandText: params.text,
  });

  let newsHeadlines;
  if (includeNews && isMarketNewsEnabled()) {
    newsHeadlines = await fetchMarketNewsHeadlines(5);
  }

  return {
    message: formatLearningTelegramMessage({
      profile,
      sessionDate,
      preamble: params.preamble,
      includeNews: includeNews && isMarketNewsEnabled(),
      newsHeadlines,
    }),
  };
}

export async function sendPreSessionLearningBrief(
  fastify: FastifyInstance,
  params: {
    watchedSymbols: string[];
    watchedStyles: TradingStyle[];
    sendMessage: (text: string) => Promise<void>;
  },
): Promise<void> {
  const includeNews = isMarketNewsEnabled();
  const built = await buildLearningTelegramMessage(fastify, {
    watchedSymbols: params.watchedSymbols,
    watchedStyles: params.watchedStyles,
    preamble: true,
    includeNews,
  });

  if (built.error) {
    throw new Error(built.error);
  }

  await params.sendMessage(built.message);
}