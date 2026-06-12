import { FyersAPI } from 'fyers-api-v3';
import { getQuoteCache } from './quote-cache';

function cloneChainResponse(
  response: FyersAPI.OptionChainResponse,
): FyersAPI.OptionChainResponse {
  return {
    ...response,
    data: {
      ...response.data,
      optionsChain: response.data.optionsChain.map((row) => ({ ...row })),
      indiavixData: { ...response.data.indiavixData },
      expiryData: [...response.data.expiryData],
    },
  };
}

function patchRow(
  row: FyersAPI.OptionChainData,
  nowMs: number,
): FyersAPI.OptionChainData {
  const quote = getQuoteCache().get(row.symbol);
  if (!quote || nowMs - quote.updatedAt > 120_000) return row;

  return {
    ...row,
    ltp: quote.ltp,
    ltpch: quote.ch,
    ltpchp: quote.chp,
  };
}

/** Apply fresher WS/REST quote cache LTPs onto a cached option-chain snapshot. */
export function patchOptionChainWithLiveQuotes(
  response: FyersAPI.OptionChainResponse,
  nowMs = Date.now(),
): FyersAPI.OptionChainResponse {
  if (response.s !== 'ok') return response;

  const patched = cloneChainResponse(response);
  patched.data.optionsChain = patched.data.optionsChain.map((row) =>
    patchRow(row, nowMs),
  );

  const vixSymbol = patched.data.indiavixData?.symbol;
  if (vixSymbol) {
    const vixQuote = getQuoteCache().get(vixSymbol);
    if (vixQuote && nowMs - vixQuote.updatedAt <= 120_000) {
      patched.data.indiavixData = {
        ...patched.data.indiavixData,
        ltp: vixQuote.ltp,
        ltpch: vixQuote.ch,
        ltpchp: vixQuote.chp,
      };
    }
  }

  return patched;
}

export function seedQuotesFromOptionChain(
  response: FyersAPI.OptionChainResponse,
  nowMs = Date.now(),
): void {
  if (response.s !== 'ok') return;
  const cache = getQuoteCache();

  for (const row of response.data.optionsChain) {
    if (!row.symbol || !(row.ltp > 0)) continue;
    cache.upsert(
      {
        symbol: row.symbol,
        ltp: row.ltp,
        ch: row.ltpch ?? 0,
        chp: row.ltpchp ?? 0,
        source: 'rest',
      },
      nowMs,
    );
  }

  const vix = response.data.indiavixData;
  if (vix?.symbol && vix.ltp > 0) {
    cache.upsert(
      {
        symbol: vix.symbol,
        ltp: vix.ltp,
        ch: vix.ltpch ?? 0,
        chp: vix.ltpchp ?? 0,
        source: 'rest',
      },
      nowMs,
    );
  }
}