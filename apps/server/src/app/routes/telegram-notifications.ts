import { FastifyInstance } from 'fastify';
import { joinTelegramLines, joinTelegramSections } from '../telegram-notifications/message-layout';

export default async function telegramNotificationsRoute(
  fastify: FastifyInstance,
) {
  fastify.get('/api/notifications/status', async (_request, reply) => {
    const status = await fastify.telegramNotifications.getStatus();
    return reply.send(status);
  });

  fastify.get('/api/notifications/fyers-usage', async (_request, reply) => {
    return reply.send(fastify.fyersUsage.getStats());
  });

  async function sendTestNotification(message?: string) {
    if (!fastify.telegramNotifications.isConfigured()) {
      return {
        statusCode: 503 as const,
        body: {
          error:
            'Telegram not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env',
        },
      };
    }

    const text =
      message?.trim() ||
      joinTelegramSections(
        '🟢 <b>Opstra alerts live</b>',
        joinTelegramLines(
          '✅ Telegram connected',
          '🔔 Signal-flip alerts enabled',
          '🕘 Polls every 1 min during market hours',
        ),
      );

    await fastify.telegramNotifications.sendMessage(text, { channel: 'test' });
    return {
      statusCode: 200 as const,
      body: { ok: true, sent: text },
    };
  }

  // GET — works when opened in a browser address bar
  fastify.get('/api/notifications/test', async (request, reply) => {
    const { message } = (request.query as { message?: string }) || {};
    const result = await sendTestNotification(message);
    return reply.code(result.statusCode).send(result.body);
  });

  fastify.post('/api/notifications/test', async (request, reply) => {
    const { message } = (request.body as { message?: string }) || {};
    const result = await sendTestNotification(message);
    return reply.code(result.statusCode).send(result.body);
  });

  fastify.post('/api/notifications/poll', async (request, reply) => {
    if (!fastify.telegramNotifications.isConfigured()) {
      return reply.code(503).send({
        error:
          'Telegram not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env',
      });
    }

    const { force, coach } = (request.query as { force?: string; coach?: string }) || {};
    const forcePoll = force === 'true' || force === '1';
    const coachOnly = coach === 'true' || coach === '1';
    await fastify.telegramNotifications.pollNow({
      force: forcePoll || coachOnly,
      coachOnly,
    });
    const status = await fastify.telegramNotifications.getStatus();
    return reply.send({ ok: true, forced: forcePoll, coachOnly, status });
  });
}