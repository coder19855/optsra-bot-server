import tokenStatusRoute from './token-status';
import {
  buildRouteApp,
  createMockFyers,
  decorateFyers,
} from '../testing/fastify-test-harness';

describe('GET /api/token-status', () => {
  it('returns token validity flag', async () => {
    const fyers = createMockFyers({
      isTokenValid: jest.fn().mockResolvedValue(true),
    });
    const app = await buildRouteApp(tokenStatusRoute, (f) =>
      decorateFyers(f, fyers),
    );
    const res = await app.inject({ method: 'GET', url: '/api/token-status' });
    expect(res.json()).toEqual({ isTokenValid: true });
    await app.close();
  });
});