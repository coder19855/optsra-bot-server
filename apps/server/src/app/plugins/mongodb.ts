import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import mongodb from '@fastify/mongodb';

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

    try {
      await fastify.register(mongodb, {
        forceClose: true,
        url,
        serverSelectionTimeoutMS: 10000,
      });
      fastify.log.info('MongoDB connected');
    } catch (err) {
      fastify.log.error(
        { err },
        'MongoDB connection failed — server will start without persistence (fix MONGODB_URL / Atlas network access / use Node 20)',
      );
    }
  },
  { name: 'mongodb' },
);