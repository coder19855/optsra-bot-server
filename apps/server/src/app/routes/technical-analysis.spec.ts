import technicalAnalysisRoute from './technical-analysis';
import momentumDecayPlugin from '../plugins/momentum-decay';
import technicalAnalysisPlugin from '../plugins/technical-analysis';
import { ResponseStatus } from '../types/common';
import {
  buildRouteApp,
  createMockFyers,
  decorateFyers,
} from '../testing/fastify-test-harness';
import { sampleCandles } from '../testing/fixtures';

describe('GET /api/technical-analysis', () => {
  it('returns 400 when any history call fails', async () => {
    const fyers = createMockFyers({
      getHistory: jest.fn().mockResolvedValue({
        s: ResponseStatus.error,
        message: 'history failed',
      }),
    });
    const app = await buildRouteApp(technicalAnalysisRoute, async (f) => {
      decorateFyers(f, fyers);
      await f.register(momentumDecayPlugin);
      await f.register(technicalAnalysisPlugin);
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/technical-analysis?symbol=NSE:NIFTY50-INDEX',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'history failed' });
    await app.close();
  });

  it('returns signal payload when history succeeds', async () => {
    const candles = sampleCandles(50);
    const fyers = createMockFyers({
      getHistory: jest.fn().mockResolvedValue({
        s: ResponseStatus.ok,
        candles,
      }),
    });
    const app = await buildRouteApp(technicalAnalysisRoute, async (f) => {
      decorateFyers(f, fyers);
      await f.register(momentumDecayPlugin);
      await f.register(technicalAnalysisPlugin);
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/technical-analysis?symbol=NSE:NIFTY50-INDEX&tradingStyle=INTRADAY',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      symbol: 'NSE:NIFTY50-INDEX',
      signal: expect.objectContaining({ action: expect.any(String) }),
      timeframeScores: expect.any(Object),
    });
    await app.close();
  });
});