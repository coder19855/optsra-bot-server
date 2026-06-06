import { HttpStatusCode } from 'axios';
import { FastifyInstance } from 'fastify';

export default async function loginRoutes(fastify: FastifyInstance) {
  fastify.get('/api/login', async (_request, reply) => {
    try {
      const isTokenValid = await fastify.fyers.isTokenValid();

      if (isTokenValid) {
        return reply.code(HttpStatusCode.Ok).send({ hasActiveToken: true });
      }

      const redirectUrl = fastify.fyers.generateAuthCode();
      return reply
        .code(HttpStatusCode.Ok)
        .send({ hasActiveToken: false, redirectUrl });
    } catch (error) {
      return reply.code(HttpStatusCode.InternalServerError).send({ error });
    }
  });
}
