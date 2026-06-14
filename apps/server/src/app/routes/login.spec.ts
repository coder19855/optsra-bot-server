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

  it('redirects when forceRedirect=true and token is invalid', async () => {
    const fyers = createMockFyers({
      isTokenValid: jest.fn().mockResolvedValue(false),
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

  it('returns HTML when forceRedirect=true and token is already valid', async () => {
    const fyers = createMockFyers({
      isTokenValid: jest.fn().mockResolvedValue(true),
    });
    const app = await buildRouteApp(loginRoute, (f) => decorateFyers(f, fyers));
    const res = await app.inject({
      method: 'GET',
      url: '/api/login?forceRedirect=1',
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('already active');
    await app.close();
  });

  it('redirects when forceRelogin=true even if token is valid', async () => {
    const fyers = createMockFyers({
      isTokenValid: jest.fn().mockResolvedValue(true),
      generateAuthCode: jest.fn().mockReturnValue('https://auth.test'),
    });
    const app = await buildRouteApp(loginRoute, (f) => decorateFyers(f, fyers));
    const res = await app.inject({
      method: 'GET',
      url: '/api/login?forceRedirect=1&forceRelogin=1',
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('https://auth.test');
    await app.close();
  });
});