import rootRoute from './root';
import { buildRouteApp } from '../testing/fastify-test-harness';

describe('GET /api (root route)', () => {
  it('returns hello message', async () => {
    const app = await buildRouteApp(rootRoute);
    const res = await app.inject({ method: 'GET', url: '/api' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ message: 'Hello API' });
    await app.close();
  });
});