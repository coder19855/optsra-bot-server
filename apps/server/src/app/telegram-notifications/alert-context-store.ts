import { FastifyInstance } from 'fastify';
import { AlertWhyContext } from '../types/alert-intelligence';

const COLLECTION = 'alert-why-context';

export async function saveAlertWhyContext(
  fastify: FastifyInstance,
  why: AlertWhyContext,
): Promise<void> {
  const col = fastify.mongo?.db?.collection(COLLECTION);
  if (!col) return;

  const key = `${why.symbol}:${why.tradingStyle}`;
  await col.updateOne(
    { key },
    {
      $set: {
        key,
        ...why,
        updatedAt: new Date(),
      },
    },
    { upsert: true },
  );
}

export async function loadAlertWhyContext(
  fastify: FastifyInstance,
  symbol: string,
  tradingStyle: string,
): Promise<AlertWhyContext | null> {
  const col = fastify.mongo?.db?.collection<AlertWhyContext & { key: string }>(
    COLLECTION,
  );
  if (!col) return null;

  const key = `${symbol}:${tradingStyle}`;
  const doc = await col.findOne({ key });
  if (!doc) return null;

  const { key: _key, ...rest } = doc;
  return rest as AlertWhyContext;
}

export async function loadLatestAlertWhyContext(
  fastify: FastifyInstance,
): Promise<AlertWhyContext | null> {
  const col = fastify.mongo?.db?.collection<AlertWhyContext & { updatedAt?: Date }>(
    COLLECTION,
  );
  if (!col) return null;

  const doc = await col.findOne({}, { sort: { updatedAt: -1 } });
  if (!doc) return null;

  return doc as AlertWhyContext;
}