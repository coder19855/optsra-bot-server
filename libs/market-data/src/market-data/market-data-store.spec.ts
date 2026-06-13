import { FyersAPI } from 'fyers-api-v3';
import {
  MarketDataStore,
  resetMarketDataStoreForTests,
} from './market-data-store';

function okHistory(candles: FyersAPI.Candle[] = []): FyersAPI.HistoryResponse {
  return { s: 'ok', code: 200, message: '', candles };
}

function okOptionChain(): FyersAPI.OptionChainResponse {
  return {
    s: 'ok',
    code: 200,
    message: '',
    data: {
      callOi: 0,
      putOi: 0,
      expiryData: [],
      indiavixData: {
        ask: 0,
        bid: 0,
        description: '',
        ex_symbol: '',
        exchange: '',
        fyToken: '',
        ltp: 12,
        ltpch: 0,
        ltpchp: 0,
        option_type: '',
        strike_price: 0,
        symbol: '',
      },
      optionsChain: [],
    },
  };
}

describe('MarketDataStore', () => {
  beforeEach(() => {
    resetMarketDataStoreForTests();
  });

  it('reuses live history within TTL', async () => {
    const store = new MarketDataStore();
    const nowMs = 1_700_000_000_000;
    const fetch = jest
      .fn()
      .mockResolvedValue(okHistory([[nowMs / 1000, 1, 2, 0.5, 1.5, 100]]));

    const params: FyersAPI.HistoryQueryRequest = {
      symbol: 'NSE:NIFTY50-INDEX',
      resolution: '5',
      range_from: '1699000000',
      range_to: String(Math.floor(nowMs / 1000)),
      cont_flag: 1,
      oi_flag: 0,
      date_format: 0,
    };

    await store.getHistory(params, fetch, nowMs);
    await store.getHistory(params, fetch, nowMs + 30_000);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(store.getStats().historyHits).toBe(1);
  });

  it('refetches history after TTL expires', async () => {
    const store = new MarketDataStore();
    const nowMs = 1_700_000_000_000;
    const fetch = jest.fn().mockResolvedValue(okHistory());

    const params: FyersAPI.HistoryQueryRequest = {
      symbol: 'NSE:NIFTY50-INDEX',
      resolution: '5',
      range_from: '1699000000',
      range_to: String(Math.floor(nowMs / 1000)),
      cont_flag: 1,
      oi_flag: 0,
      date_format: 0,
    };

    await store.getHistory(params, fetch, nowMs);
    await store.getHistory(params, fetch, nowMs + 61_000);

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not share cache between historical and live queries', async () => {
    const store = new MarketDataStore();
    const nowMs = 1_700_000_000_000;
    const fetch = jest.fn().mockResolvedValue(okHistory());

    const live: FyersAPI.HistoryQueryRequest = {
      symbol: 'NSE:NIFTY50-INDEX',
      resolution: '15',
      range_from: '1699000000',
      range_to: String(Math.floor(nowMs / 1000)),
      cont_flag: 1,
      oi_flag: 0,
      date_format: 0,
    };
    const historical: FyersAPI.HistoryQueryRequest = {
      ...live,
      range_to: String(Math.floor((nowMs - 24 * 60 * 60 * 1000) / 1000)),
    };

    await store.getHistory(live, fetch, nowMs);
    await store.getHistory(historical, fetch, nowMs);

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('caches option chain responses', async () => {
    const store = new MarketDataStore();
    const fetch = jest.fn().mockResolvedValue(okOptionChain());
    const params: FyersAPI.OptionChainRequest = {
      symbol: 'NSE:NIFTY50-INDEX',
      strikecount: 10,
      timestamp: '',
      greeks: 1,
    };

    await store.getOptionChain(params, fetch, 1_700_000_000_000);
    await store.getOptionChain(params, fetch, 1_700_000_030_000);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(store.getStats().optionChainHits).toBe(1);
  });
});