import { FastifyInstance } from 'fastify';
import { FYERS_OPTION_INDEX_SYMBOLS } from '../constants/fyers-symbols';
import { AlertWhyContext } from '../types/alert-intelligence';
import { ExactStrikeRecommendation } from '../types/exact-strike-recommendation';
import { TradingStyle } from '../types/trading-style';
import { loadAlertWhyContext } from './alert-context-store';
import { fetchTradeDecisionAlert } from './trade-decision-fetch';

const SYMBOL_ALIASES: Record<string, string> = {
  NIFTY: 'NSE:NIFTY50-INDEX',
  NIFTY50: 'NSE:NIFTY50-INDEX',
  BANKNIFTY: 'NSE:NIFTYBANK-INDEX',
  NIFTYBANK: 'NSE:NIFTYBANK-INDEX',
  FINNIFTY: 'NSE:FINNIFTY-INDEX',
  MIDCPNIFTY: 'NSE:MIDCPNIFTY-INDEX',
};

function resolveIndexSymbol(token: string): string {
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

function parseWhyArgs(
  text: string,
  defaults: { symbol: string; style: TradingStyle },
): { symbol: string; style: TradingStyle; forceLive: boolean } {
  const parts = text.split(/\s+/).filter(Boolean);
  const forceLive = parts[1]?.toLowerCase() === 'live';

  if (forceLive) {
    const symbolToken = parts[2] ?? defaults.symbol.split(':')[1]?.replace('-INDEX', '') ?? 'NIFTY50';
    const styleToken = parts[3] ?? defaults.style;
    return {
      symbol: resolveIndexSymbol(symbolToken),
      style: parseStyle(String(styleToken)),
      forceLive: true,
    };
  }

  if (parts.length >= 3) {
    return {
      symbol: resolveIndexSymbol(parts[1]),
      style: parseStyle(parts[2]),
      forceLive: false,
    };
  }

  return { symbol: defaults.symbol, style: defaults.style, forceLive: false };
}

function parseStyle(value: string): TradingStyle {
  const upper = value.toUpperCase();
  if (upper === TradingStyle.Scalper) return TradingStyle.Scalper;
  if (upper === TradingStyle.Positional) return TradingStyle.Positional;
  return TradingStyle.Intraday;
}

export async function resolveWhyContext(
  fastify: FastifyInstance,
  params: {
    text: string;
    defaultSymbol: string;
    defaultStyle: TradingStyle;
    getExactStrikeForKey?: (
      symbol: string,
      style: TradingStyle,
    ) => ExactStrikeRecommendation | undefined;
  },
): Promise<{
  why: AlertWhyContext | null;
  exactStrike?: ExactStrikeRecommendation;
  error?: string;
}> {
  const args = parseWhyArgs(params.text, {
    symbol: params.defaultSymbol,
    style: params.defaultStyle,
  });

  if (!args.forceLive) {
    const stored = await loadAlertWhyContext(
      fastify,
      args.symbol,
      args.style,
    );

    if (stored) {
      const exactStrike = params.getExactStrikeForKey?.(
        stored.symbol,
        stored.tradingStyle,
      );
      return { why: stored, exactStrike };
    }
  }

  const sessionReady = await fastify.ensureFyersSession();
  if (!sessionReady) {
    return {
      why: null,
      error:
        'Fyers token is invalid or expired — cannot fetch a live read. Re-login, or wait for the next alert.',
    };
  }

  try {
    const payload = await fetchTradeDecisionAlert(
      fastify,
      args.symbol,
      args.style,
    );
    if (!payload?.whyContext) {
      return { why: null, error: 'Could not build a live signal breakdown.' };
    }

    return {
      why: {
        ...payload.whyContext,
        source: 'live',
        wasNotified: false,
        alertedAt: new Date().toISOString(),
      },
      exactStrike: payload.exactStrikeRecommendation,
    };
  } catch (err) {
    return {
      why: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}