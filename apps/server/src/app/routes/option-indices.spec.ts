import optionIndicesRoute from './option-indices';
import { FYERS_OPTION_INDEX_SYMBOLS } from '../constants/fyers-symbols';
import { buildRouteApp } from '../testing/fastify-test-harness';

describe('GET /api/symbols/option-indices', () => {
  it('returns all indices without filter', async () => {
    const app = await buildRouteApp(optionIndicesRoute);
    const res = await app.inject({
      method: 'GET',
      url: '/api/symbols/option-indices',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(FYERS_OPTION_INDEX_SYMBOLS);
    await app.close();
  });

  it('filters by NSE', async () => {
    const app = await buildRouteApp(optionIndicesRoute);
    const res = await app.inject({
      method: 'GET',
      url: '/api/symbols/option-indices?exchange=NSE',
    });
    const body = res.json() as Array<{ exchange: string }>;
    expect(body.every((x) => x.exchange === 'NSE')).toBe(true);
    await app.close();
  });

  it('rejects invalid exchange', async () => {
    const app = await buildRouteApp(optionIndicesRoute);
    const res = await app.inject({
      method: 'GET',
      url: '/api/symbols/option-indices?exchange=FOREX',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: 'exchange must be NSE or BSE when provided',
    });
    await app.close();
  });
});