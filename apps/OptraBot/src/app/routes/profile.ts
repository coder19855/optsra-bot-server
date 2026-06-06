import { HttpStatusCode } from 'axios';
import { FastifyInstance } from 'fastify';
import { ResponseStatus } from '../types';

export default async function logoutRoutes(fastify: FastifyInstance) {
  fastify.get('/api/profile', async (_request, reply) => {
    try {
      const response = await fastify.fyers.get_profile();

      if (response.s === ResponseStatus.ok) {
        return reply.status(HttpStatusCode.Ok).send({
          message: 'Profile retrieved successfully',
          data: response.data,
        });
      } else {
        return reply.status(response.code).send({ error: response.message });
      }
    } catch (error) {
      reply.code(HttpStatusCode.InternalServerError).send({ error });
    }
  });
}
