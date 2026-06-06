import { HttpStatusCode } from 'axios';
import { FastifyInstance } from 'fastify';
import { ResponseStatus } from '../types';

export default async function logoutRoutes(fastify: FastifyInstance) {
  fastify.get('/api/logout', async (_request, reply) => {
    try {
      const isTokenValid = await fastify.fyers.isTokenValid();

      if (!isTokenValid) {
        return reply
          .code(HttpStatusCode.BadRequest)
          .send({ error: 'No active token found' });
      }

      const response = await fastify.fyers.logout_user();

      if (response.s === ResponseStatus.ok) {
        fastify.fyers.setAccessToken('');
        fastify.mongo.db?.collection('access-tokens').deleteMany({});

        return reply
          .status(response.code)
          .send({ message: 'Logout successful' });
      } else {
        return reply.status(response.code).send({ error: response.message });
      }
    } catch (error) {
      reply.code(HttpStatusCode.InternalServerError).send({ error });
    }
  });
}
