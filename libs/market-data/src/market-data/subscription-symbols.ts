import { FyersAPI } from 'fyers-api-v3';
import { FYERS_MARKET_STREAM_DEFAULTS } from '../constants/fyers-market-stream';

export function symbolsFromOptionChain(
  response: FyersAPI.OptionChainResponse,
  indexSymbol: string,
): string[] {
  const symbols = new Set<string>();
  symbols.add(indexSymbol);
  symbols.add(FYERS_MARKET_STREAM_DEFAULTS.INDIA_VIX_SYMBOL);

  if (response.s !== 'ok') return [...symbols];

  const vixSymbol = response.data.indiavixData?.symbol;
  if (vixSymbol) symbols.add(vixSymbol);

  for (const row of response.data.optionsChain) {
    if (row.symbol) symbols.add(row.symbol);
  }

  return [...symbols];
}

export function diffSymbolSets(
  desired: Set<string>,
  active: Set<string>,
): { subscribe: string[]; unsubscribe: string[] } {
  const subscribe: string[] = [];
  const unsubscribe: string[] = [];

  for (const symbol of desired) {
    if (!active.has(symbol)) subscribe.push(symbol);
  }
  for (const symbol of active) {
    if (!desired.has(symbol)) unsubscribe.push(symbol);
  }

  return { subscribe, unsubscribe };
}