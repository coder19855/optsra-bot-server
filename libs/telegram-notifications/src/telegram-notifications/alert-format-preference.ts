import { FastifyInstance } from 'fastify';
import { TELEGRAM_NOTIFICATION_DEFAULTS } from '../constants/telegram-notifications';
import {
  AlertFormatMode,
  DEFAULT_ALERT_FORMAT,
  normalizeAlertFormatMode,
} from '../types/alert-format';

const ALERT_FORMAT_PREFERENCE_KEY = 'alert-format-preference';

export interface AlertFormatPreferenceState {
  alertFormat: AlertFormatMode;
}

export async function loadAlertFormatPreference(
  fastify: FastifyInstance,
  memoryState: AlertFormatPreferenceState,
): Promise<AlertFormatPreferenceState> {
  const col = fastify.mongo?.db?.collection<
    AlertFormatPreferenceState & { key: string }
  >(TELEGRAM_NOTIFICATION_DEFAULTS.SESSION_STATE_COLLECTION);
  if (!col) return memoryState;

  const doc = await col.findOne({ key: ALERT_FORMAT_PREFERENCE_KEY });
  if (!doc?.alertFormat) return memoryState;

  return {
    alertFormat: normalizeAlertFormatMode(doc.alertFormat),
  };
}

export async function saveAlertFormatPreference(
  fastify: FastifyInstance,
  _memoryState: AlertFormatPreferenceState,
  alertFormat: AlertFormatMode,
): Promise<AlertFormatPreferenceState> {
  const next: AlertFormatPreferenceState = {
    alertFormat: normalizeAlertFormatMode(alertFormat),
  };

  const col = fastify.mongo?.db?.collection<
    AlertFormatPreferenceState & { key: string }
  >(TELEGRAM_NOTIFICATION_DEFAULTS.SESSION_STATE_COLLECTION);
  if (col) {
    await col.updateOne(
      { key: ALERT_FORMAT_PREFERENCE_KEY },
      { $set: { key: ALERT_FORMAT_PREFERENCE_KEY, ...next } },
      { upsert: true },
    );
  }

  return next;
}

export function defaultAlertFormatPreferenceState(): AlertFormatPreferenceState {
  return { alertFormat: DEFAULT_ALERT_FORMAT };
}