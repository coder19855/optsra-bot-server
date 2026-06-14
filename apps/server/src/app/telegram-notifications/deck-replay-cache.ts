import { FastifyInstance } from 'fastify';
import { FlowMode } from '../types/flow-mode';
import { VetoMode } from '../types/veto-mode';
import { DeckReplayPayload } from './deck-service';

const COLLECTION = 'deck-replay-cache';
const PAST_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CURRENT_SESSION_TTL_MS = 2 * 60 * 1000;

const memory = new Map<
  string,
  { payload: DeckReplayPayload; expiresAt: number }
>();

export function deckReplayCacheKey(params: {
  symbol: string;
  tradingStyle?: string;
  sessionDate: string;
  vetoMode: VetoMode;
  flowMode: FlowMode;
}): string {
  return [
    params.symbol.trim(),
    (params.tradingStyle || 'INTRADAY').toUpperCase(),
    params.sessionDate,
    params.vetoMode,
    params.flowMode,
  ].join('|');
}

function ttlForSessionDate(sessionDate: string, todaySessionDate: string): number {
  return sessionDate === todaySessionDate
    ? CURRENT_SESSION_TTL_MS
    : PAST_SESSION_TTL_MS;
}

export async function loadCachedDeckReplay(
  fastify: FastifyInstance,
  key: string,
): Promise<DeckReplayPayload | null> {
  const mem = memory.get(key);
  if (mem) {
    if (mem.expiresAt <= Date.now()) {
      memory.delete(key);
    } else {
      return mem.payload;
    }
  }

  const col = fastify.mongo?.db?.collection<{
    key: string;
    payload: DeckReplayPayload;
    expiresAt: Date;
  }>(COLLECTION);
  if (!col) return null;

  const doc = await col.findOne({ key });
  if (!doc?.payload) return null;

  const expiresAt =
    doc.expiresAt instanceof Date
      ? doc.expiresAt.getTime()
      : new Date(doc.expiresAt).getTime();
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    return null;
  }

  memory.set(key, { payload: doc.payload, expiresAt });
  return doc.payload;
}

export async function saveCachedDeckReplay(
  fastify: FastifyInstance,
  key: string,
  payload: DeckReplayPayload,
  sessionDate: string,
  todaySessionDate: string,
): Promise<void> {
  const expiresAt = Date.now() + ttlForSessionDate(sessionDate, todaySessionDate);
  memory.set(key, { payload, expiresAt });

  const col = fastify.mongo?.db?.collection(COLLECTION);
  if (!col) return;

  await col.updateOne(
    { key },
    {
      $set: {
        key,
        payload,
        expiresAt: new Date(expiresAt),
        updatedAt: new Date(),
      },
    },
    { upsert: true },
  );
}

export async function getOrBuildDeckReplayPayload(
  fastify: FastifyInstance,
  params: {
    symbol: string;
    tradingStyle?: string;
    sessionDate: string;
    vetoMode: VetoMode;
    flowMode: FlowMode;
    todaySessionDate: string;
  },
  build: () => Promise<DeckReplayPayload>,
): Promise<DeckReplayPayload> {
  const key = deckReplayCacheKey(params);
  const cached = await loadCachedDeckReplay(fastify, key);
  if (cached) return cached;

  const payload = await build();
  await saveCachedDeckReplay(
    fastify,
    key,
    payload,
    params.sessionDate,
    params.todaySessionDate,
  );
  return payload;
}