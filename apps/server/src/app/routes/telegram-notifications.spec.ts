import telegramNotificationsRoute from './telegram-notifications';
import {
  buildRouteApp,
  decorateFyersUsage,
  decorateTelegramNotifications,
} from '../testing/fastify-test-harness';

describe('telegram-notifications routes', () => {
  it('GET /api/notifications/status returns status payload', async () => {
    const status = { enabled: true, polling: true };
    const app = await buildRouteApp(telegramNotificationsRoute, (f) => {
      decorateTelegramNotifications(f, { getStatus: status });
      decorateFyersUsage(f);
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/notifications/status',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(status);
    await app.close();
  });

  it('GET /api/notifications/test returns 503 when unconfigured', async () => {
    const app = await buildRouteApp(telegramNotificationsRoute, (f) => {
      decorateTelegramNotifications(f, { isConfigured: false });
      decorateFyersUsage(f);
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/notifications/test',
    });
    expect(res.statusCode).toBe(503);
    await app.close();
  });

  it('POST /api/notifications/poll passes force and coach flags', async () => {
    let pollNow: jest.Mock;
    const app = await buildRouteApp(telegramNotificationsRoute, (f) => {
      const tg = decorateTelegramNotifications(f, { isConfigured: true });
      pollNow = tg.pollNow as jest.Mock;
      decorateFyersUsage(f);
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/notifications/poll?force=true&coach=1',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      ok: true,
      forced: true,
      coachOnly: true,
    });
    expect(pollNow!).toHaveBeenCalledWith({
      force: true,
      coachOnly: true,
    });
    await app.close();
  });
});