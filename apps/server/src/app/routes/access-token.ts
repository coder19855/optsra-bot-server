import { HttpStatusCode } from 'axios';
import { FastifyInstance } from 'fastify';
import { ResponseStatus } from '../types';

export default async function accessTokenRoutes(fastify: FastifyInstance) {
  fastify.get('/api/access-token', async (request, reply) => {
    const { authCode } = request.query as { authCode: string };

    if (!authCode) {
      reply
        .code(HttpStatusCode.BadRequest)
        .send({ error: 'Missing auth code in query parameters' });
    }

    const SECRET_KEY = process.env.FYERS_API_SECRET || '';

    try {
      const authResponse = await fastify.fyers.generate_access_token({
        secret_key: SECRET_KEY,
        auth_code: authCode,
      });

      if (authResponse.s === ResponseStatus.ok) {
        fastify.fyers.setAccessToken(authResponse.access_token);
        await fastify.mongo?.db?.collection('access-tokens').insertOne({
          token: authResponse.access_token,
          timestamp: Date.now(),
        });

        return reply
          .status(authResponse.code)
          .send({ message: 'Authentication successful' });
      } else {
        return reply
          .code(authResponse.code)
          .send({ error: authResponse.message });
      }
    } catch (error) {
      reply.code(HttpStatusCode.InternalServerError).send({ error });
    }
  });
}
