import { FyersAPI } from 'fyers-api-v3';
import { getQuoteCache, resetQuoteCacheForTests } from './quote-cache';
import {
  patchOptionChainWithLiveQuotes,
  seedQuotesFromOptionChain,
} from './option-chain-patch';

function sampleChain(): FyersAPI.OptionChainResponse {
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
        ltp: 14,
        ltpch: 0,
        ltpchp: 0,
        option_type: '',
        strike_price: 0,
        symbol: 'NSE:INDIAVIX-INDEX',
      },
      optionsChain: [
        {
          symbol: 'NSE:NIFTY50-INDEX',
          ltp: 25000,
          ltpch: 10,
          ltpchp: 0.04,
          strike_price: 0,
          option_type: 'XX',
        } as FyersAPI.OptionChainData,
        {
          symbol: 'NSE:NIFTY2661623200CE',
          ltp: 120,
          ltpch: 1,
          ltpchp: 0.8,
          strike_price: 25000,
          option_type: 'CE',
        } as FyersAPI.OptionChainData,
      ],
    },
  };
}

describe('option-chain-patch', () => {
  beforeEach(() => {
    resetQuoteCacheForTests();
  });

  it('patches chain rows from quote cache', () => {
    const chain = sampleChain();
    seedQuotesFromOptionChain(chain);

    getQuoteCache().upsert({
      symbol: 'NSE:NIFTY2661623200CE',
      ltp: 145,
      ch: 5,
      chp: 3.5,
      source: 'ws',
    });

    const patched = patchOptionChainWithLiveQuotes(chain);
    const optionRow = patched.data.optionsChain.find(
      (row) => row.symbol === 'NSE:NIFTY2661623200CE',
    );

    expect(optionRow?.ltp).toBe(145);
    expect(optionRow?.ltpch).toBe(5);
  });
});