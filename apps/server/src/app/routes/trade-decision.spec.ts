import tradeDecisionRoute from './trade-decision';
import { buildRouteApp } from '../testing/fastify-test-harness';
import {
  sampleOptionMetrics as optionFixture,
  samplePriceAction as priceFixture,
} from '../testing/fixtures';
import decisionEnginePlugin from '../plugins/decision-engine';
import momentumDecayPlugin from '../plugins/momentum-decay';

function decorateTradeDecisionTestDeps(fastify: import('fastify').FastifyInstance) {
  fastify.decorate(
    'ensureFyersSession',
    jest.fn().mockResolvedValue(true),
  );
}

describe('GET /api/trade-decision', () => {
  it('returns 400 when symbol is missing', async () => {
    const app = await buildRouteApp(tradeDecisionRoute, async (f) => {
      decorateTradeDecisionTestDeps(f);
      await f.register(momentumDecayPlugin);
      await f.register(decisionEnginePlugin);
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/trade-decision',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'symbol is required' });
    await app.close();
  });

  it('returns 503 when Fyers session is unavailable', async () => {
    const app = await buildRouteApp(tradeDecisionRoute, async (f) => {
      f.decorate('ensureFyersSession', jest.fn().mockResolvedValue(false));
      await f.register(momentumDecayPlugin);
      await f.register(decisionEnginePlugin);
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/trade-decision?symbol=NSE:NIFTY50-INDEX',
    });
    expect(res.statusCode).toBe(503);
    await app.close();
  });

  it('returns 502 when upstream analysis routes fail', async () => {
    const app = await buildRouteApp(tradeDecisionRoute, async (f) => {
      decorateTradeDecisionTestDeps(f);
      await f.register(momentumDecayPlugin);
      await f.register(decisionEnginePlugin);
      const originalInject = f.inject.bind(f);
      f.inject = jest.fn(async (opts) => {
        if (String(opts.url).includes('technical-analysis')) {
          return { statusCode: 500, body: '{}' };
        }
        return originalInject(opts);
      }) as typeof f.inject;
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/trade-decision?symbol=NSE:NIFTY50-INDEX',
    });
    expect(res.statusCode).toBe(502);
    await app.close();
  });

  it('assembles trade decision when upstream routes succeed', async () => {
    const price = priceFixture();
    const option = optionFixture();
    const app = await buildRouteApp(tradeDecisionRoute, async (f) => {
      decorateTradeDecisionTestDeps(f);
      await f.register(momentumDecayPlugin);
      await f.register(decisionEnginePlugin);
      const originalInject = f.inject.bind(f);
      f.inject = jest.fn(async (opts) => {
        const url = String(opts.url);
        if (url.includes('technical-analysis')) {
          return { statusCode: 200, body: JSON.stringify(price) };
        }
        if (url.includes('score-metrics')) {
          return { statusCode: 200, body: JSON.stringify(option) };
        }
        return originalInject(opts);
      }) as typeof f.inject;
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/trade-decision?symbol=NSE:NIFTY50-INDEX&tradingStyle=INTRADAY',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      symbol: 'NSE:NIFTY50-INDEX',
      tradingStyle: 'INTRADAY',
      action: expect.any(String),
      conviction: expect.any(Number),
      tradeGuidance: expect.objectContaining({
        shouldConsiderTrade: expect.any(Boolean),
      }),
      optionFlow: expect.objectContaining({
        components: expect.any(Array),
      }),
    });
    await app.close();
  });

  it('returns scalper trade guidance with distinct thresholds', async () => {
    const price = priceFixture();
    const option = optionFixture();
    const app = await buildRouteApp(tradeDecisionRoute, async (f) => {
      decorateTradeDecisionTestDeps(f);
      await f.register(momentumDecayPlugin);
      await f.register(decisionEnginePlugin);
      const originalInject = f.inject.bind(f);
      f.inject = jest.fn(async (opts) => {
        const url = String(opts.url);
        if (url.includes('technical-analysis')) {
          return { statusCode: 200, body: JSON.stringify(price) };
        }
        if (url.includes('score-metrics')) {
          return { statusCode: 200, body: JSON.stringify(option) };
        }
        return originalInject(opts);
      }) as typeof f.inject;
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/trade-decision?symbol=NSE:NIFTY50-INDEX&tradingStyle=SCALPER',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tradingStyle).toBe('SCALPER');
    expect(body.tradeGuidance.chosenTradingStyle).toBe('SCALPER');
    expect(body.tradeGuidance.scoringWeights).toMatchObject({
      priceAction: expect.any(Number),
      optionFlow: expect.any(Number),
    });
    await app.close();
  });
});