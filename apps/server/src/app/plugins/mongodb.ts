import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { MongoClient, ObjectId } from 'mongodb';
import { ensureMongoStorageIndexes } from '../telegram-notifications/mongo-storage';
import { startOptionChainSnapshotScheduler } from '../telegram-notifications/option-chain-snapshot-store';

function parseDatabaseName(url: string): string | undefined {
  const match = url.match(/mongodb(?:\+srv)?:\/\/[^/]+\/([^?]+)/);
  return match?.[1] || undefined;
}

export default fp(
  async (fastify: FastifyInstance) => {
    const url = process.env.MONGODB_URL;
    if (!url) {
      fastify.log.warn(
        'MONGODB_URL not set — skipping mongodb plugin registration',
      );
      return;
    }

    if (url.includes('127.0.0.1') || url.includes('localhost')) {
      fastify.log.warn(
        'MONGODB_URL points to localhost — skipping mongodb on cloud deploy',
      );
      return;
    }

    const client = new MongoClient(url, {
      serverSelectionTimeoutMS: 8000,
      connectTimeoutMS: 8000,
    });

    try {
      await client.connect();
      const dbName = parseDatabaseName(url);
      const db = dbName ? client.db(dbName) : client.db();
      await db.command({ ping: 1 });

      fastify.decorate('mongo', { client, ObjectId, db });
      fastify.addHook('onClose', async () => {
        await client.close(true);
      });
      void ensureMongoStorageIndexes(fastify).catch((err) => {
        fastify.log.warn({ err }, 'Mongo storage index setup failed');
      });
      startOptionChainSnapshotScheduler(fastify);

      fastify.log.info(
        { database: db.databaseName },
        'MongoDB connected',
      );
    } catch (err) {
      await client.close(true).catch(() => undefined);
      fastify.log.error(
        { err },
        'MongoDB unavailable — server starting without persistence. Fix Atlas Network Access (allow 0.0.0.0/0) and verify MONGODB_URL.',
      );
    }
  },
  { name: 'mongodb' },
);