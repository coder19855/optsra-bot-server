import accessTokenRoute from './access-token';
import { ResponseStatus } from '../types/common';
import {
  buildRouteApp,
  createMockFyers,
  decorateFyers,
  decorateMongo,
  decorateTelegramNotifications,
} from '../testing/fastify-test-harness';

describe('GET /api/access-token', () => {
  it('returns 400 when auth code is missing', async () => {
    const app = await buildRouteApp(accessTokenRoute, (f) =>
      decorateFyers(f, createMockFyers()),
    );
    const res = await app.inject({ method: 'GET', url: '/api/access-token' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: 'Missing auth code in query parameters',
    });
    await app.close();
  });

  it('returns JSON success on token exchange', async () => {
    const fyers = createMockFyers({
      generate_access_token: jest.fn().mockResolvedValue({
        s: ResponseStatus.ok,
        access_token: 'token-abc',
        code: 200,
      }),
    });
    const app = await buildRouteApp(accessTokenRoute, (f) => {
      decorateFyers(f, fyers);
      decorateMongo(f);
      decorateTelegramNotifications(f);
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/access-token?auth_code=abc123',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ message: 'Authentication successful' });
    expect(fyers.setAccessToken).toHaveBeenCalledWith('token-abc');
    await app.close();
  });

  it('returns HTML when Accept header requests it', async () => {
    const fyers = createMockFyers({
      generate_access_token: jest.fn().mockResolvedValue({
        s: ResponseStatus.ok,
        access_token: 'token-abc',
        code: 200,
      }),
    });
    const app = await buildRouteApp(accessTokenRoute, (f) => {
      decorateFyers(f, fyers);
      decorateMongo(f);
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/access-token?auth_code=abc123',
      headers: { accept: 'text/html' },
    });
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('Fyers connected');
    await app.close();
  });
});