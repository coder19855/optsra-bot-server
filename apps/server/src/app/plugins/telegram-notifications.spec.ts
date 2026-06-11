import fp from 'fastify-plugin';
import telegramNotificationsPlugin from './telegram-notifications';
import { buildPluginApp, decorateMongo } from '../testing/fastify-test-harness';

jest.mock('axios', () => ({
  post: jest.fn().mockResolvedValue({
    data: { ok: true, result: { message_id: 1 } },
  }),
  get: jest.fn().mockResolvedValue({ data: { ok: true, result: [] } }),
  default: {
    post: jest.fn().mockResolvedValue({
      data: { ok: true, result: { message_id: 1 } },
    }),
    get: jest.fn().mockResolvedValue({ data: { ok: true, result: [] } }),
  },
}));

async function registerPluginDeps(fastify: import('fastify').FastifyInstance) {
  decorateMongo(fastify);
  await fastify.register(
    fp(
      async (instance) => {
        instance.decorate('fyers', {});
        instance.decorate(
          'ensureFyersSession',
          jest.fn().mockResolvedValue(false),
        );
      },
      { name: 'fyers' },
    ),
  );
  await fastify.register(
    fp(
      async (instance) => {
        instance.decorate('fyersUsage', {
          beginScope: jest.fn(),
          endScope: jest.fn(),
          record: jest.fn(),
          getStats: jest.fn(),
        });
      },
      { name: 'fyers-usage' },
    ),
  );
}

describe('telegram-notifications plugin', () => {
  const envBackup = { ...process.env };

  afterEach(() => {
    process.env = { ...envBackup };
  });

  it('reports unconfigured without bot token and chat id', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    const app = await buildPluginApp(telegramNotificationsPlugin, registerPluginDeps);
    expect(app.telegramNotifications.isConfigured()).toBe(false);
    await app.close();
  });

  it('reports configured when token and chat id are set', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    process.env.TELEGRAM_CHAT_ID = '12345';
    const app = await buildPluginApp(telegramNotificationsPlugin, registerPluginDeps);
    expect(app.telegramNotifications.isConfigured()).toBe(true);
    await app.close();
  });
});