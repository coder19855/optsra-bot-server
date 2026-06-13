import { TradingStyle } from '../types/trading-style';
import { loadStylePreference, saveStylePreference } from './style-preference';

describe('style-preference', () => {
  it('round-trips style preference in memory when mongo is absent', async () => {
    const fastify = { mongo: undefined } as never;
    const saved = await saveStylePreference(
      fastify,
      { tradingStyle: TradingStyle.Intraday },
      TradingStyle.Scalper,
    );
    expect(saved.tradingStyle).toBe(TradingStyle.Scalper);
    const loaded = await loadStylePreference(fastify, {
      tradingStyle: TradingStyle.Intraday,
    });
    expect(loaded.tradingStyle).toBe(TradingStyle.Intraday);
  });
});