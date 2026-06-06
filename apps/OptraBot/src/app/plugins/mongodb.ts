import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import mongodb from '@fastify/mongodb';

export default fp(
  async (fastify: FastifyInstance) => {
    await fastify.register(mongodb, {
      forceClose: true,
      url: process.env.MONGODB_URL,
    });
  },
  { name: 'mongodb' },
);
