import { FastifyInstance } from 'fastify';
import { TELEGRAM_NOTIFICATION_DEFAULTS } from '../constants/telegram-notifications';
import { FlowMode, normalizeFlowMode } from '../types/flow-mode';

const FLOW_PREFERENCE_KEY = 'flow-preference';

export interface FlowPreferenceState {
  flowMode: FlowMode;
}

export { parseFlowModeQuery } from '../types/flow-mode';

export async function loadFlowPreference(
  fastify: FastifyInstance,
  memoryState: FlowPreferenceState,
): Promise<FlowPreferenceState> {
  const col = fastify.mongo?.db?.collection<
    FlowPreferenceState & { key: string }
  >(TELEGRAM_NOTIFICATION_DEFAULTS.SESSION_STATE_COLLECTION);
  if (!col) return memoryState;

  const doc = await col.findOne({ key: FLOW_PREFERENCE_KEY });
  if (doc?.flowMode == null) return memoryState;

  return { flowMode: normalizeFlowMode(doc.flowMode) };
}

export async function saveFlowPreference(
  fastify: FastifyInstance,
  _memoryState: FlowPreferenceState,
  flowMode: FlowMode,
): Promise<FlowPreferenceState> {
  const next: FlowPreferenceState = {
    flowMode: normalizeFlowMode(flowMode),
  };

  const col = fastify.mongo?.db?.collection<
    FlowPreferenceState & { key: string }
  >(TELEGRAM_NOTIFICATION_DEFAULTS.SESSION_STATE_COLLECTION);
  if (col) {
    await col.updateOne(
      { key: FLOW_PREFERENCE_KEY },
      { $set: { key: FLOW_PREFERENCE_KEY, ...next } },
      { upsert: true },
    );
  }

  return next;
}