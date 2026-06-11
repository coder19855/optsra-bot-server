import tradingCoachRoute from './trading-coach';
import { buildRouteApp } from '../testing/fastify-test-harness';

jest.mock('../trading-coach/analyze', () => ({
  runTradingCoachAnalysis: jest.fn(),
}));

import { runTradingCoachAnalysis } from '../trading-coach/analyze';

const mockedRun = runTradingCoachAnalysis as jest.Mock;

describe('GET /api/trading-coach', () => {
  beforeEach(() => {
    mockedRun.mockReset();
  });

  it('returns 400 for invalid date filter', async () => {
    const app = await buildRouteApp(tradingCoachRoute);
    const res = await app.inject({
      method: 'GET',
      url: '/api/trading-coach?days=not-a-number',
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('returns coach payload on success', async () => {
    mockedRun.mockResolvedValue({
      tradingStyle: 'INTRADAY',
      summary: { headline: 'Test' },
      trades: [],
      rawFillCount: 0,
    });
    const app = await buildRouteApp(tradingCoachRoute);
    const res = await app.inject({
      method: 'GET',
      url: '/api/trading-coach?tradingStyle=INTRADAY',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      tradingStyle: 'INTRADAY',
      summary: { headline: 'Test' },
    });
    await app.close();
  });

  it('falls back to default preMinutes when query is invalid', async () => {
    mockedRun.mockResolvedValue({
      tradingStyle: 'INTRADAY',
      summary: {},
      trades: [],
      rawFillCount: 0,
    });
    const app = await buildRouteApp(tradingCoachRoute);
    await app.inject({
      method: 'GET',
      url: '/api/trading-coach?preMinutes=abc',
    });
    expect(mockedRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ preMinutes: expect.any(Number) }),
    );
    await app.close();
  });
});