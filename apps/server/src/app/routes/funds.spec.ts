import fundsRoute from './funds';
import {
  buildRouteApp,
  createMockFyers,
  decorateFyers,
  okFundsResponse,
  errorFyersResponse,
} from '../testing/fastify-test-harness';

describe('GET /api/funds', () => {
  it('returns fund limits on success', async () => {
    const fyers = createMockFyers({
      get_funds: jest.fn().mockResolvedValue(okFundsResponse),
    });
    const app = await buildRouteApp(fundsRoute, (f) => decorateFyers(f, fyers));
    const res = await app.inject({ method: 'GET', url: '/api/funds' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      message: 'Funds retrieved successfully',
      data: okFundsResponse.fund_limit,
    });
    await app.close();
  });

  it('returns upstream error on failure', async () => {
    const fyers = createMockFyers({
      get_funds: jest.fn().mockResolvedValue(errorFyersResponse),
    });
    const app = await buildRouteApp(fundsRoute, (f) => decorateFyers(f, fyers));
    const res = await app.inject({ method: 'GET', url: '/api/funds' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Upstream error' });
    await app.close();
  });
});