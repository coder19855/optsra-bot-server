import { FastifyInstance } from 'fastify';
import { TELEGRAM_NOTIFICATION_DEFAULTS } from '../constants/telegram-notifications';
import { runTradingCoachAnalysis } from '../trading-coach/analyze';
import { SignalSnapshot } from '../types/telegram-notifications';
import { DEFAULT_TELEGRAM_VOICE, TelegramVoice } from '../types/telegram-voice';
import { TradingStyle } from '../types/trading-style';
import {
  formatTelegramCoachErrorMessage,
  formatTelegramCoachSummaryMessage,
  watchedStylesForCoach,
} from './coach-summary-formatter';

export interface SessionCoachState {
  lastSessionDate: string | null;
  lastSentAt: Date | null;
  lastError: string | null;
}

export async function loadSessionCoachState(
  fastify: FastifyInstance,
  memoryState: SessionCoachState,
): Promise<SessionCoachState> {
  const col = fastify.mongo?.db?.collection<SessionCoachState & { key: string }>(
    TELEGRAM_NOTIFICATION_DEFAULTS.SESSION_STATE_COLLECTION,
  );
  if (!col) return memoryState;

  const doc = await col.findOne({ key: 'coach-summary' });
  if (!doc) return memoryState;

  return {
    lastSessionDate: doc.lastSessionDate ?? null,
    lastSentAt: doc.lastSentAt ? new Date(doc.lastSentAt) : null,
    lastError: doc.lastError ?? null,
  };
}

export async function saveSessionCoachState(
  fastify: FastifyInstance,
  memoryState: SessionCoachState,
  update: Partial<SessionCoachState>,
): Promise<SessionCoachState> {
  const next: SessionCoachState = {
    lastSessionDate: update.lastSessionDate ?? memoryState.lastSessionDate,
    lastSentAt: update.lastSentAt ?? memoryState.lastSentAt,
    lastError: update.lastError ?? memoryState.lastError,
  };

  const col = fastify.mongo?.db?.collection<SessionCoachState & { key: string }>(
    TELEGRAM_NOTIFICATION_DEFAULTS.SESSION_STATE_COLLECTION,
  );
  if (col) {
    await col.updateOne(
      { key: 'coach-summary' },
      { $set: { key: 'coach-summary', ...next } },
      { upsert: true },
    );
  }

  return next;
}

export async function buildSessionCoachSummaries(
  fastify: FastifyInstance,
  params: {
    sessionDate: string;
    symbols: string[];
    styles: TradingStyle[];
  },
) {
  const styles = watchedStylesForCoach(params.styles);
  const indexFilter = params.symbols.length === 1 ? params.symbols[0] : undefined;
  const coaches = [];

  for (const tradingStyle of styles) {
    const coach = await runTradingCoachAnalysis(fastify, {
      tradingStyle,
      indexFilter,
      dateRange: null,
    });
    coaches.push(coach);
  }

  return coaches;
}

export async function sendSessionCoachSummary(
  fastify: FastifyInstance,
  params: {
    sessionDate: string;
    symbols: string[];
    styles: TradingStyle[];
    snapshots: SignalSnapshot[];
    sendMessage: (text: string) => Promise<void>;
    voice?: TelegramVoice;
  },
): Promise<{ sent: boolean; message?: string }> {
  const voice = params.voice ?? DEFAULT_TELEGRAM_VOICE;
  try {
    const coaches = await buildSessionCoachSummaries(fastify, {
      sessionDate: params.sessionDate,
      symbols: params.symbols,
      styles: params.styles,
    });

    const message = formatTelegramCoachSummaryMessage({
      sessionDate: params.sessionDate,
      coaches,
      snapshots: params.snapshots,
      voice,
    });

    await params.sendMessage(message);
    return { sent: true, message };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const message = formatTelegramCoachErrorMessage({
      sessionDate: params.sessionDate,
      error,
      snapshots: params.snapshots,
      voice,
    });
    await params.sendMessage(message);
    return { sent: true, message };
  }
}