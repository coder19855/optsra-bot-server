import technicalAnalysisTimelineRoute from './technical-analysis-timeline';
import momentumDecayPlugin from '../plugins/momentum-decay';
import technicalAnalysisPlugin from '../plugins/technical-analysis';
import { ResponseStatus } from '../types/common';
import {
  buildRouteApp,
  createMockFyers,
  decorateFyers,
} from '../testing/fastify-test-harness';
import { sampleCandles } from '../testing/fixtures';

describe('GET /api/technical-analysis/timeline', () => {
  it('returns 400 when symbol is missing', async () => {
    const app = await buildRouteApp(technicalAnalysisTimelineRoute, async (f) => {
      decorateFyers(f, createMockFyers());
      await f.register(momentumDecayPlugin);
      await f.register(technicalAnalysisPlugin);
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/technical-analysis/timeline',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'symbol is required' });
    await app.close();
  });

  it('returns 400 when candle history is empty', async () => {
    const fyers = createMockFyers({
      getHistory: jest.fn().mockResolvedValue({
        s: ResponseStatus.ok,
        candles: [],
      }),
    });
    const app = await buildRouteApp(technicalAnalysisTimelineRoute, async (f) => {
      decorateFyers(f, fyers);
      await f.register(momentumDecayPlugin);
      await f.register(technicalAnalysisPlugin);
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/technical-analysis/timeline?symbol=NSE:NIFTY50-INDEX',
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('returns timeline points when history is available', async () => {
    const candles = sampleCandles(120);
    const fyers = createMockFyers({
      getHistory: jest.fn().mockResolvedValue({
        s: ResponseStatus.ok,
        candles,
      }),
    });
    const app = await buildRouteApp(technicalAnalysisTimelineRoute, async (f) => {
      decorateFyers(f, fyers);
      await f.register(momentumDecayPlugin);
      await f.register(technicalAnalysisPlugin);
    });
    const toSec = candles[candles.length - 1][0];
    const res = await app.inject({
      method: 'GET',
      url: `/api/technical-analysis/timeline?symbol=NSE:NIFTY50-INDEX&days=3&interval=15&to=${toSec}&sessionOnly=false`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.points).toEqual(expect.any(Array));
    expect(body.summary).toEqual(expect.any(Object));
    await app.close();
  });
});