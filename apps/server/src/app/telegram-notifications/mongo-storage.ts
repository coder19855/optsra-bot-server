import { FastifyInstance } from 'fastify';
import { TELEGRAM_NOTIFICATION_DEFAULTS } from '../constants/telegram-notifications';

const ACCESS_TOKEN_DOC_ID = 'latest';
let indexesEnsured = false;

export async function ensureMongoStorageIndexes(
  fastify: FastifyInstance,
): Promise<void> {
  if (indexesEnsured || !fastify.mongo?.db) return;

  const outcomes = fastify.mongo.db.collection(
    TELEGRAM_NOTIFICATION_DEFAULTS.SIGNAL_OUTCOMES_COLLECTION,
  );
  const retentionDays =
    TELEGRAM_NOTIFICATION_DEFAULTS.SIGNAL_OUTCOME_RETENTION_DAYS;

  await outcomes.createIndex(
    { closedAt: 1 },
    {
      name: 'ttl_closed_outcomes',
      expireAfterSeconds: retentionDays * 24 * 60 * 60,
      partialFilterExpression: {
        status: { $in: ['win', 'loss', 'flat'] },
        closedAt: { $type: 'date' },
      },
    },
  );

  indexesEnsured = true;
  fastify.log.info(
    { retentionDays },
    'Mongo storage TTL indexes ensured',
  );
}

export async function upsertLatestAccessToken(
  fastify: FastifyInstance,
  token: string,
): Promise<void> {
  const col = fastify.mongo?.db?.collection<{
    _id: string;
    token: string;
    timestamp: number;
  }>('access-tokens');
  if (!col) return;

  await col.updateOne(
    { _id: ACCESS_TOKEN_DOC_ID },
    { $set: { token, timestamp: Date.now() } },
    { upsert: true },
  );
}

/** Test-only reset */
export function resetMongoStorageForTests(): void {
  indexesEnsured = false;
}