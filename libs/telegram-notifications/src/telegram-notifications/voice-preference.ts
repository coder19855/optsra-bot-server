import { FastifyInstance } from 'fastify';
import { TELEGRAM_NOTIFICATION_DEFAULTS } from '../constants/telegram-notifications';
import {
  DEFAULT_TELEGRAM_VOICE,
  TELEGRAM_VOICES,
  TelegramVoice,
} from '../types/telegram-voice';

const VOICE_PREFERENCE_KEY = 'voice-preference';

export interface VoicePreferenceState {
  voice: TelegramVoice;
}

export function parseTelegramVoiceArg(value: string | undefined): TelegramVoice | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'trader' || normalized === 'english' || normalized === 'en') {
    return 'trader';
  }
  if (normalized === 'simple' || normalized === 'hindi' || normalized === 'hi') {
    return 'simple';
  }
  if (
    normalized === 'tapori' ||
    normalized === 'topori' ||
    normalized === 'bhai'
  ) {
    return 'tapori';
  }
  if (
    normalized === 'marathi' ||
    normalized === 'marathi-english' ||
    normalized === 'mumbai' ||
    normalized === 'mr'
  ) {
    return 'marathi';
  }
  return TELEGRAM_VOICES.includes(normalized as TelegramVoice)
    ? (normalized as TelegramVoice)
    : null;
}

export async function loadVoicePreference(
  fastify: FastifyInstance,
  memoryState: VoicePreferenceState,
): Promise<VoicePreferenceState> {
  const col = fastify.mongo?.db?.collection<
    VoicePreferenceState & { key: string }
  >(TELEGRAM_NOTIFICATION_DEFAULTS.SESSION_STATE_COLLECTION);
  if (!col) return memoryState;

  const doc = await col.findOne({ key: VOICE_PREFERENCE_KEY });
  if (!doc?.voice) return memoryState;

  return {
    voice: TELEGRAM_VOICES.includes(doc.voice) ? doc.voice : DEFAULT_TELEGRAM_VOICE,
  };
}

export async function saveVoicePreference(
  fastify: FastifyInstance,
  memoryState: VoicePreferenceState,
  voice: TelegramVoice,
): Promise<VoicePreferenceState> {
  const next: VoicePreferenceState = { voice };

  const col = fastify.mongo?.db?.collection<
    VoicePreferenceState & { key: string }
  >(TELEGRAM_NOTIFICATION_DEFAULTS.SESSION_STATE_COLLECTION);
  if (col) {
    await col.updateOne(
      { key: VOICE_PREFERENCE_KEY },
      { $set: { key: VOICE_PREFERENCE_KEY, ...next } },
      { upsert: true },
    );
  }

  return next;
}