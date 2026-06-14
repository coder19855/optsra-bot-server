import { FYERS_OPTION_INDEX_SYMBOLS } from '../constants/fyers-symbols';
import { TradingStyle } from '../types/trading-style';

const SYMBOL_ALIASES: Record<string, string> = {
  NIFTY: 'NSE:NIFTY50-INDEX',
  NIFTY50: 'NSE:NIFTY50-INDEX',
  BANKNIFTY: 'NSE:NIFTYBANK-INDEX',
  NIFTYBANK: 'NSE:NIFTYBANK-INDEX',
  FINNIFTY: 'NSE:FINNIFTY-INDEX',
  MIDCPNIFTY: 'NSE:MIDCPNIFTY-INDEX',
};

export function resolveIndexSymbol(token: string): string {
  const upper = token.toUpperCase();
  if (upper.includes(':')) return upper;
  if (SYMBOL_ALIASES[upper]) return SYMBOL_ALIASES[upper];

  const meta = FYERS_OPTION_INDEX_SYMBOLS.find(
    (row) =>
      row.shortName.toUpperCase() === upper ||
      row.id.toUpperCase() === upper ||
      row.underlying.toUpperCase() === upper,
  );
  return meta?.symbol ?? `NSE:${upper}-INDEX`;
}

export function parseTradingStyleArg(value: string): TradingStyle | null {
  const upper = value.toUpperCase();
  if (upper === TradingStyle.Scalper) return TradingStyle.Scalper;
  if (upper === TradingStyle.Positional) return TradingStyle.Positional;
  if (upper === TradingStyle.Intraday) return TradingStyle.Intraday;
  return null;
}

/** Parse `/cmd`, `/cmd NIFTY`, `/cmd INTRADAY`, or `/cmd NIFTY INTRADAY`. */
export function parseSymbolStyleCommandArgs(
  text: string,
  defaults: { symbol: string; style: TradingStyle },
): { symbol: string; style: TradingStyle } {
  const parts = text.split(/\s+/).filter(Boolean);

  if (parts.length >= 3) {
    return {
      symbol: resolveIndexSymbol(parts[1]),
      style: parseTradingStyleArg(parts[2]) ?? defaults.style,
    };
  }

  if (parts.length === 2) {
    const style = parseTradingStyleArg(parts[1]);
    if (style) {
      return { symbol: resolveIndexSymbol(defaults.symbol), style };
    }
    return {
      symbol: resolveIndexSymbol(parts[1]),
      style: defaults.style,
    };
  }

  return {
    symbol: resolveIndexSymbol(defaults.symbol),
    style: defaults.style,
  };
}

export function shortIndexLabel(symbol: string): string {
  return symbol.split(':')[1]?.replace('-INDEX', '') ?? symbol;
}

/** Parse `/beststrike`, `/beststrike CE`, `/beststrike NIFTY INTRADAY`, etc. */
export function parseBestStrikeCommandArgs(
  text: string,
  defaults: { symbol: string; style: TradingStyle },
): { symbol: string; style: TradingStyle; side?: 'CE' | 'PE' } {
  const parts = text.split(/\s+/).filter(Boolean).slice(1);
  let symbol = defaults.symbol;
  let style = defaults.style;
  let side: 'CE' | 'PE' | undefined;

  for (const part of parts) {
    const upper = part.toUpperCase();
    if (upper === 'CE' || upper === 'PE') {
      side = upper as 'CE' | 'PE';
      continue;
    }
    const parsedStyle = parseTradingStyleArg(part);
    if (parsedStyle) {
      style = parsedStyle;
      continue;
    }
    symbol = resolveIndexSymbol(part);
  }

  return { symbol, style, side };
}