import { FastifyInstance } from 'fastify';
import { TELEGRAM_NOTIFICATION_DEFAULTS } from '../constants/telegram-notifications';
import { AIProvider } from '../types/ai-agent';

const AI_BETA_PREFERENCE_KEY = 'ai-beta-preference';

export interface AiBetaPreferenceState {
  enabled: boolean;
  provider: AIProvider;
  shadowMode: boolean;
}

export async function loadAiBetaPreference(
  fastify: FastifyInstance,
  memoryState: AiBetaPreferenceState,
): Promise<AiBetaPreferenceState> {
  const col = fastify.mongo?.db?.collection<
    AiBetaPreferenceState & { key: string }
  >(TELEGRAM_NOTIFICATION_DEFAULTS.SESSION_STATE_COLLECTION);
  if (!col) return memoryState;

  const doc = await col.findOne({ key: AI_BETA_PREFERENCE_KEY });
  if (!doc) return memoryState;

  return {
    enabled: doc.enabled ?? memoryState.enabled,
    provider: (doc.provider as AIProvider) ?? memoryState.provider,
    shadowMode: doc.shadowMode ?? memoryState.shadowMode,
  };
}

export async function saveAiBetaPreference(
  fastify: FastifyInstance,
  _memoryState: AiBetaPreferenceState,
  update: Partial<AiBetaPreferenceState>,
): Promise<AiBetaPreferenceState> {
  const current = await loadAiBetaPreference(fastify, _memoryState);
  const next: AiBetaPreferenceState = { ...current, ...update };

  const col = fastify.mongo?.db?.collection<
    AiBetaPreferenceState & { key: string }
  >(TELEGRAM_NOTIFICATION_DEFAULTS.SESSION_STATE_COLLECTION);
  if (col) {
    await col.updateOne(
      { key: AI_BETA_PREFERENCE_KEY },
      { $set: { key: AI_BETA_PREFERENCE_KEY, ...next } },
      { upsert: true },
    );
  }

  return next;
}

export function defaultAiBetaPreferenceState(): AiBetaPreferenceState {
  return {
    enabled: false,
    provider: (process.env.ACTIVE_AI_PROVIDER as AIProvider) || 'GEMINI',
    shadowMode: true,
  };
}
