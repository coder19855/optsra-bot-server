import { HttpStatusCode } from 'axios';
import { FastifyInstance } from 'fastify';
import { ResponseStatus } from '../types';

function resolveAuthCode(query: Record<string, unknown>): string | undefined {
  const authCode = query.auth_code ?? query.authCode;
  if (typeof authCode === 'string' && authCode.trim()) {
    return authCode.trim();
  }
  return undefined;
}

export default async function accessTokenRoutes(fastify: FastifyInstance) {
  fastify.get('/api/access-token', async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const authCode = resolveAuthCode(query);

    if (!authCode) {
      return reply.code(HttpStatusCode.BadRequest).send({
        error: 'Missing auth code in query parameters',
        hint: 'Fyers redirects with ?auth_code=... — open /api/login first, then complete OAuth.',
        receivedQueryKeys: Object.keys(query),
      });
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

        const accept = request.headers.accept || '';
        if (accept.includes('text/html')) {
          return reply.type('text/html').send(`
            <!DOCTYPE html>
            <html><body style="font-family:sans-serif;padding:2rem">
              <h2>✅ Fyers connected</h2>
              <p>Authentication successful. You can close this tab.</p>
              <p>Token saved — Telegram alerts will use live Fyers data until expiry (~24h).</p>
            </body></html>
          `);
        }

        return reply
          .status(authResponse.code)
          .send({ message: 'Authentication successful' });
      }

      return reply
        .code(authResponse.code)
        .send({ error: authResponse.message });
    } catch (error) {
      return reply
        .code(HttpStatusCode.InternalServerError)
        .send({ error });
    }
  });
}