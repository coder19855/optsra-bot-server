import logoutRoute from './logout';
import { ResponseStatus } from '../types/common';
import {
  buildRouteApp,
  createMockFyers,
  decorateFyers,
  decorateMongo,
} from '../testing/fastify-test-harness';

describe('GET /api/logout', () => {
  it('returns 400 when no active token', async () => {
    const fyers = createMockFyers({
      isTokenValid: jest.fn().mockResolvedValue(false),
    });
    const app = await buildRouteApp(logoutRoute, (f) => decorateFyers(f, fyers));
    const res = await app.inject({ method: 'GET', url: '/api/logout' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'No active token found' });
    await app.close();
  });

  it('clears token and mongo on successful logout', async () => {
    const fyers = createMockFyers({
      isTokenValid: jest.fn().mockResolvedValue(true),
      logout_user: jest.fn().mockResolvedValue({
        s: ResponseStatus.ok,
        code: 200,
        message: 'ok',
      }),
    });
    const app = await buildRouteApp(logoutRoute, (f) => {
      decorateFyers(f, fyers);
      decorateMongo(f);
    });
    const res = await app.inject({ method: 'GET', url: '/api/logout' });
    expect(res.statusCode).toBe(200);
    expect(fyers.setAccessToken).toHaveBeenCalledWith('');
    await app.close();
  });
});