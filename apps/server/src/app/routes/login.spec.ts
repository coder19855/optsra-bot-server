import loginRoute from './login';
import {
  buildRouteApp,
  createMockFyers,
  decorateFyers,
} from '../testing/fastify-test-harness';

describe('GET /api/login', () => {
  it('returns hasActiveToken when session is valid', async () => {
    const fyers = createMockFyers({
      isTokenValid: jest.fn().mockResolvedValue(true),
    });
    const app = await buildRouteApp(loginRoute, (f) => decorateFyers(f, fyers));
    const res = await app.inject({ method: 'GET', url: '/api/login' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ hasActiveToken: true });
    await app.close();
  });

  it('returns redirect URL when token is invalid', async () => {
    const fyers = createMockFyers({
      isTokenValid: jest.fn().mockResolvedValue(false),
      generateAuthCode: jest.fn().mockReturnValue('https://auth.test'),
    });
    const app = await buildRouteApp(loginRoute, (f) => decorateFyers(f, fyers));
    const res = await app.inject({ method: 'GET', url: '/api/login' });
    expect(res.json()).toEqual({
      hasActiveToken: false,
      redirectUrl: 'https://auth.test',
    });
    await app.close();
  });

  it('redirects when forceRedirect=true', async () => {
    const fyers = createMockFyers({
      generateAuthCode: jest.fn().mockReturnValue('https://auth.test'),
    });
    const app = await buildRouteApp(loginRoute, (f) => decorateFyers(f, fyers));
    const res = await app.inject({
      method: 'GET',
      url: '/api/login?forceRedirect=1',
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('https://auth.test');
    await app.close();
  });
});