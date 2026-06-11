import { FastifyInstance } from 'fastify';
import { TELEGRAM_NOTIFICATION_DEFAULTS } from '../constants/telegram-notifications';
import { normalizeVetoMode, VetoMode } from '../types/veto-mode';

const VETO_PREFERENCE_KEY = 'veto-preference';

export interface VetoPreferenceState {
  vetoMode: VetoMode;
}

export type { VetoMode };

export { parseVetoOffQuery, parseVetoModeQuery } from '../types/veto-mode';

export async function loadVetoPreference(
  fastify: FastifyInstance,
  memoryState: VetoPreferenceState,
): Promise<VetoPreferenceState> {
  const col = fastify.mongo?.db?.collection<
    VetoPreferenceState & { key: string; vetoOff?: boolean }
  >(TELEGRAM_NOTIFICATION_DEFAULTS.SESSION_STATE_COLLECTION);
  if (!col) return memoryState;

  const doc = await col.findOne({ key: VETO_PREFERENCE_KEY });
  if (doc == null) return memoryState;

  const vetoMode =
    doc.vetoMode != null
      ? normalizeVetoMode(doc.vetoMode)
      : doc.vetoOff
        ? 'off'
        : 'strict';

  return { vetoMode };
}

export async function saveVetoPreference(
  fastify: FastifyInstance,
  _memoryState: VetoPreferenceState,
  vetoMode: VetoMode,
): Promise<VetoPreferenceState> {
  const next: VetoPreferenceState = { vetoMode: normalizeVetoMode(vetoMode) };

  const col = fastify.mongo?.db?.collection<
    VetoPreferenceState & { key: string }
  >(TELEGRAM_NOTIFICATION_DEFAULTS.SESSION_STATE_COLLECTION);
  if (col) {
    await col.updateOne(
      { key: VETO_PREFERENCE_KEY },
      { $set: { key: VETO_PREFERENCE_KEY, ...next }, $unset: { vetoOff: '' } },
      { upsert: true },
    );
  }

  return next;
}