import { HttpStatusCode } from 'axios';
import { FastifyInstance } from 'fastify';

function isTruthyQueryFlag(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  const normalized = String(value).trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

function loginAlreadyActiveHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Fyers — already logged in</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; line-height: 1.5; color: #111; }
    .card { max-width: 28rem; padding: 1.25rem 1.5rem; border-radius: 12px; background: #f0fdf4; border: 1px solid #86efac; }
    h1 { font-size: 1.25rem; margin: 0 0 0.5rem; }
    p { margin: 0.5rem 0 0; color: #334155; }
  </style>
</head>
<body>
  <div class="card">
    <h1>✅ Fyers session is already active</h1>
    <p>Your token is valid. Close this tab and return to Telegram — no login needed.</p>
    <p>If commands still fail, run <code>/login</code> in the bot and use <b>Force refresh token</b>.</p>
  </div>
</body>
</html>`;
}

export default async function loginRoutes(fastify: FastifyInstance) {
  fastify.get('/api/login', async (request, reply) => {
    try {
      const { forceRedirect, forceRelogin } = request.query as {
        forceRedirect?: string;
        forceRelogin?: string;
      };
      const shouldRedirect = isTruthyQueryFlag(forceRedirect);
      const shouldForceRelogin = isTruthyQueryFlag(forceRelogin);

      await fastify.fyers.initialize();
      const isTokenValid = await fastify.fyers.isTokenValid();

      if (isTokenValid && !shouldForceRelogin) {
        if (shouldRedirect) {
          return reply
            .code(HttpStatusCode.Ok)
            .type('text/html; charset=utf-8')
            .send(loginAlreadyActiveHtml());
        }
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