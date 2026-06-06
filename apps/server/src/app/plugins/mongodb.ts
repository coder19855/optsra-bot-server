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

    await fastify.register(mongodb, {
      forceClose: true,
      url,
    });
  },
  { name: 'mongodb' },
);
