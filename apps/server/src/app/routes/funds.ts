import { FastifyInstance } from 'fastify';
import { ResponseStatus } from '../types';
import { HttpStatusCode } from 'axios';

export default async function fundsRoutes(fastify: FastifyInstance) {
  fastify.get('/api/funds', async (_request, reply) => {
    try {
      const response = await fastify.fyers.get_funds();

      if (response.s === ResponseStatus.ok) {
        return reply.status(response.code).send({
          message: 'Funds retrieved successfully',
          data: response.fund_limit,
        });
      } else {
        return reply.status(response.code).send({ error: response.message });
      }
    } catch (error) {
      return reply.status(HttpStatusCode.InternalServerError).send({ error });
    }
  });
}
