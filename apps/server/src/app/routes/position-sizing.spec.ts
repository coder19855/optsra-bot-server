import positionSizingRoute from './position-sizing';
import { ResponseStatus } from '../types/common';
import {
  buildRouteApp,
  createMockFyers,
  decorateFyers,
  okFundsResponse,
} from '../testing/fastify-test-harness';
import { samplePriceAction } from '../testing/fixtures';

describe('GET /api/position-sizing', () => {
  it('returns 400 when available balance is zero', async () => {
    const fyers = createMockFyers({
      get_funds: jest.fn().mockResolvedValue({
        ...okFundsResponse,
        fund_limit: [
          { title: 'Available Balance', equityAmount: 0, commodityAmount: 0 },
        ],
      }),
    });
    const app = await buildRouteApp(positionSizingRoute, (f) =>
      decorateFyers(f, fyers),
    );
    const res = await app.inject({
      method: 'GET',
      url: '/api/position-sizing?riskPoints=40',
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('computes sizing from manual riskPoints without symbol', async () => {
    const fyers = createMockFyers({
      get_funds: jest.fn().mockResolvedValue(okFundsResponse),
    });
    const app = await buildRouteApp(positionSizingRoute, (f) =>
      decorateFyers(f, fyers),
    );
    const res = await app.inject({
      method: 'GET',
      url: '/api/position-sizing?riskPoints=50&tradingStyle=INTRADAY',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.sizing.recommendedLots).toEqual(expect.any(Number));
    expect(body.account.availableBalance).toBeGreaterThan(0);
    await app.close();
  });

  it('applies margin cap when premium is passed', async () => {
    const fyers = createMockFyers({
      get_funds: jest.fn().mockResolvedValue(okFundsResponse),
    });
    const app = await buildRouteApp(positionSizingRoute, (f) =>
      decorateFyers(f, fyers),
    );
    const res = await app.inject({
      method: 'GET',
      url: '/api/position-sizing?riskPoints=50&tradingStyle=INTRADAY&premium=180',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.sizing.maxLotsByMargin).not.toBeNull();
    expect(body.inputs.premium).toBe(180);
    await app.close();
  });

  it('uses technical-analysis inject when symbol is provided', async () => {
    const price = samplePriceAction({
      tradeSetup: {
        entry: 25000,
        stopLoss: 24950,
        rawStopLoss: 24950,
        risk: 50,
        takeProfits: [],
        atrUsed: 20,
        stopAdjusted: false,
      },
    });
    const fyers = createMockFyers({
      get_funds: jest.fn().mockResolvedValue(okFundsResponse),
    });
    const app = await buildRouteApp(positionSizingRoute, async (f) => {
      decorateFyers(f, fyers);
      const originalInject = f.inject.bind(f);
      f.inject = jest.fn(async (opts) => {
        if (String(opts.url).includes('technical-analysis')) {
          return { statusCode: 200, body: JSON.stringify(price) };
        }
        return originalInject(opts);
      }) as typeof f.inject;
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/position-sizing?symbol=NSE:NIFTY50-INDEX&tradingStyle=INTRADAY',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().inputs.symbol).toContain('NIFTY');
    await app.close();
  });
});