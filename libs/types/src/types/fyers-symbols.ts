export type OptionIndexExchange = 'NSE' | 'BSE';

/**
 * Fyers symbology for index underlyings used by history, quotes, and option-chain APIs.
 * Format: `{EXCHANGE}:{SYMBOL}-INDEX` (see Fyers symbol master CSV).
 */
export interface OptionIndexSymbol {
  /** Stable id for UI keys */
  id: string;
  /** Human-readable label */
  label: string;
  /** Common market name */
  shortName: string;
  /** Fyers API symbol, e.g. NSE:NIFTY50-INDEX */
  symbol: string;
  exchange: OptionIndexExchange;
  /** Underlying ticker in Fyers FO master (e.g. BANKNIFTY for NIFTYBANK-INDEX) */
  underlying: string;
  lotSize: number;
  tickSize: number;
}

export type OptionIndexSymbolsResponse = OptionIndexSymbol[];