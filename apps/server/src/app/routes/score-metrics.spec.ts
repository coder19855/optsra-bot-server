import scoreMetricsRoute from './score-metrics';
import utilsPlugin from '../plugins/utils';
import metricCalculationPlugin from '../plugins/metric-calculation';
import supportResistancePlugin from '../plugins/support-resistance';
import strategyMapperPlugin from '../plugins/strategy-mapper';
import explanationPlugin from '../plugins/explanation';
import { ResponseStatus } from '../types/common';
import {
  buildRouteApp,
  createMockFyers,
  decorateFyers,
} from '../testing/fastify-test-harness';
import { sampleOptionChain } from '../testing/fixtures';

describe('GET /api/score-metrics', () => {
  async function registerScorePlugins(fastify: import('fastify').FastifyInstance) {
    await fastify.register(utilsPlugin);
    await fastify.register(metricCalculationPlugin);
    await fastify.register(supportResistancePlugin);
    await fastify.register(strategyMapperPlugin);
    await fastify.register(explanationPlugin);
  }

  it('returns error when option chain fetch fails', async () => {
    const fyers = createMockFyers({
      getOptionChain: jest.fn().mockResolvedValue({
        s: ResponseStatus.error,
        code: 400,
        message: 'chain failed',
      }),
    });
    const app = await buildRouteApp(scoreMetricsRoute, async (f) => {
      decorateFyers(f, fyers);
      await registerScorePlugins(f);
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/score-metrics?symbol=NSE:NIFTY50-INDEX',
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('returns score metrics for a valid option chain', async () => {
    const chain = sampleOptionChain(25000);
    const fyers = createMockFyers({
      getOptionChain: jest.fn().mockResolvedValue({
        s: ResponseStatus.ok,
        data: {
          optionsChain: [
            {
              ltp: 25000,
              symbol: 'NSE:NIFTY50-INDEX',
              ltpch: 10,
              ltpchp: 0.04,
            },
            ...chain,
          ],
          indiavixData: { ltp: 14 },
        },
      }),
    });
    const app = await buildRouteApp(scoreMetricsRoute, async (f) => {
      decorateFyers(f, fyers);
      await registerScorePlugins(f);
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/score-metrics?symbol=NSE:NIFTY50-INDEX&tradingStyle=INTRADAY',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      score: expect.any(Number),
      bias: expect.any(String),
      components: expect.any(Object),
    });
    await app.close();
  });
});