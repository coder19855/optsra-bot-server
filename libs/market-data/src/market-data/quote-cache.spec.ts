import { getQuoteCache, resetQuoteCacheForTests } from './quote-cache';

describe('QuoteCache', () => {
  beforeEach(() => {
    resetQuoteCacheForTests();
  });

  it('stores and returns fresh LTP', () => {
    const cache = getQuoteCache();
    cache.upsert({
      symbol: 'NSE:NIFTY50-INDEX',
      ltp: 25010,
      ch: 10,
      chp: 0.04,
      source: 'ws',
    });

    expect(cache.getLtp('NSE:NIFTY50-INDEX')).toBe(25010);
  });

  it('builds index spot ring from websocket ticks', () => {
    const cache = getQuoteCache();
    const now = 1_700_000_000_000;
    cache.upsert(
      {
        symbol: 'NSE:NIFTY50-INDEX',
        ltp: 25000,
        ch: 0,
        chp: 0,
        source: 'ws',
      },
      now,
    );
    cache.upsert(
      {
        symbol: 'NSE:NIFTY50-INDEX',
        ltp: 25005,
        ch: 5,
        chp: 0.02,
        source: 'ws',
      },
      now + 2000,
    );

    const ring = cache.getSpotRing('NSE:NIFTY50-INDEX', 60_000, now + 2000);
    expect(ring.length).toBeGreaterThanOrEqual(1);
    expect(ring[ring.length - 1].v).toBe(25005);
  });
});