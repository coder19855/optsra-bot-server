import { FyersAPI } from 'fyers-api-v3';

export interface MarketStreamCoordinatorHooks {
  onOptionChainFetched: (
    indexSymbol: string,
    response: FyersAPI.OptionChainResponse,
  ) => void;
  syncOpenOutcomeSymbols: (symbols: string[]) => void;
  addWatchIndexSymbols: (symbols: string[]) => void;
}

let hooks: MarketStreamCoordinatorHooks | null = null;

export function bindMarketStreamHooks(
  next: MarketStreamCoordinatorHooks | null,
): void {
  hooks = next;
}

export function notifyOptionChainFetched(
  indexSymbol: string,
  response: FyersAPI.OptionChainResponse,
): void {
  hooks?.onOptionChainFetched(indexSymbol, response);
}

export function notifyOpenOutcomeSymbols(symbols: string[]): void {
  hooks?.syncOpenOutcomeSymbols(symbols);
}

export function notifyWatchIndexSymbols(symbols: string[]): void {
  hooks?.addWatchIndexSymbols(symbols);
}