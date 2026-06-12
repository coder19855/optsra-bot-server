import fp from 'fastify-plugin';
import marketDataCachePlugin from './market-data-cache';
import fyersUsagePlugin from './fyers-usage';
import { resetMarketDataStoreForTests } from '../market-data/market-data-store';
import {
  buildPluginApp,
  createMockFyers,
  registerNamedFyersStub,
} from '../testing/fastify-test-harness';

describe('market-data-cache plugin', () => {
  beforeEach(() => {
    resetMarketDataStoreForTests();
  });

  it('registers marketDataCache and dedupes getHistory', async () => {
    const fyers = createMockFyers();
    fyers.getHistory.mockResolvedValue({
      s: 'ok',
      code: 200,
      message: '',
      candles: [[1_700_000_000, 1, 2, 0.5, 1.5, 100]],
    });

    const app = await buildPluginApp(marketDataCachePlugin, async (fastify) => {
      await registerNamedFyersStub(fastify, fyers);
      await fastify.register(fyersUsagePlugin);
    });

    const params = {
      symbol: 'NSE:NIFTY50-INDEX',
      resolution: '5',
      range_from: '1699000000',
      range_to: String(Math.floor(Date.now() / 1000)),
      cont_flag: 1 as const,
      oi_flag: 0 as const,
      date_format: 0 as const,
    };

    await app.fyers.getHistory(params);
    await app.fyers.getHistory(params);

    const stats = app.marketDataCache.getStats();
    expect(stats.historyHits).toBe(1);
    expect(stats.historyMisses).toBe(1);
    expect(app.fyersUsage.getStats().totals.byMethodSession.getHistory).toBe(1);

    await app.close();
  });
});