import { HttpStatusCode } from 'axios';
import { FastifyInstance } from 'fastify';

export default async function tokenStatusRoutes(fastify: FastifyInstance) {
  fastify.get('/api/token-status', async (_request, reply) => {
    try {
      const isTokenValid = await fastify.fyers.isTokenValid();
      return { isTokenValid };
    } catch (error) {
      return reply.status(HttpStatusCode.InternalServerError).send({ error });
    }
  });
}
