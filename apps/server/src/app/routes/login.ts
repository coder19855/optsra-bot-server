import { HttpStatusCode } from 'axios';
import { FastifyInstance } from 'fastify';

function isTruthyQueryFlag(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  const normalized = String(value).trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

export default async function loginRoutes(fastify: FastifyInstance) {
  fastify.get('/api/login', async (request, reply) => {
    try {
      const { forceRedirect } = request.query as { forceRedirect?: string };
      const shouldRedirect = isTruthyQueryFlag(forceRedirect);
      const isTokenValid = await fastify.fyers.isTokenValid();

      if (isTokenValid) {
        return reply.code(HttpStatusCode.Ok).send({ hasActiveToken: true });
      }

      const redirectUrl = fastify.fyers.generateAuthCode();

      if (shouldRedirect) {
        return reply.redirect(redirectUrl);
      }

      return reply
        .code(HttpStatusCode.Ok)
        .send({ hasActiveToken: false, redirectUrl });
    } catch (error) {
      return reply.code(HttpStatusCode.InternalServerError).send({ error });
    }
  });
}