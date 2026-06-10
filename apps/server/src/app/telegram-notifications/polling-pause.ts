import { FastifyInstance } from 'fastify';
import { TELEGRAM_NOTIFICATION_DEFAULTS } from '../constants/telegram-notifications';

const POLLING_PAUSE_KEY = 'polling-pause';

export interface PollingPauseState {
  alertsPaused: boolean;
  pausedAt: Date | null;
}

export async function loadPollingPauseState(
  fastify: FastifyInstance,
  memoryState: PollingPauseState,
): Promise<PollingPauseState> {
  const col = fastify.mongo?.db?.collection<
    PollingPauseState & { key: string; pausedAt?: Date | string | null }
  >(TELEGRAM_NOTIFICATION_DEFAULTS.SESSION_STATE_COLLECTION);
  if (!col) return memoryState;

  const doc = await col.findOne({ key: POLLING_PAUSE_KEY });
  if (!doc) return memoryState;

  return {
    alertsPaused: doc.alertsPaused ?? false,
    pausedAt: doc.pausedAt ? new Date(doc.pausedAt) : null,
  };
}

export async function savePollingPauseState(
  fastify: FastifyInstance,
  memoryState: PollingPauseState,
  update: Partial<PollingPauseState>,
): Promise<PollingPauseState> {
  const next: PollingPauseState = {
    alertsPaused: update.alertsPaused ?? memoryState.alertsPaused,
    pausedAt:
      update.pausedAt !== undefined ? update.pausedAt : memoryState.pausedAt,
  };

  const col = fastify.mongo?.db?.collection<
    PollingPauseState & { key: string }
  >(TELEGRAM_NOTIFICATION_DEFAULTS.SESSION_STATE_COLLECTION);
  if (col) {
    await col.updateOne(
      { key: POLLING_PAUSE_KEY },
      { $set: { key: POLLING_PAUSE_KEY, ...next } },
      { upsert: true },
    );
  }

  return next;
}