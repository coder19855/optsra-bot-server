import { resolvePublicAppBaseUrl } from './fyers-login-reminder';

export type DeckMode = 'live' | 'replay';

export function resolveDeckBaseUrl(): string | null {
  return resolvePublicAppBaseUrl();
}

export function buildDeckWebAppUrl(params: {
  symbol: string;
  tradingStyle: string;
  mode?: DeckMode;
  sessionDate?: string;
}): string | null {
  const base = resolveDeckBaseUrl();
  if (!base) return null;

  const query = new URLSearchParams({
    symbol: params.symbol,
    style: params.tradingStyle,
    mode: params.mode ?? 'live',
  });
  if (params.sessionDate) {
    query.set('date', params.sessionDate);
  }
  return `${base}/deck/?${query.toString()}`;
}

export function buildBenchmarkWebAppUrl(params: {
  symbol: string;
  tradingStyle: string;
  days?: number;
  aiMode?: string;
  maxTradesPerDay?: number;
}): string | null {
  const base = resolveDeckBaseUrl();
  if (!base) return null;

  const query = new URLSearchParams({
    symbol: params.symbol,
    style: params.tradingStyle,
    days: String(params.days ?? 14),
    aiMode: params.aiMode ?? 'shadow',
  });
  if (params.maxTradesPerDay != null) {
    query.set('maxTrades', String(params.maxTradesPerDay));
  }
  return `${base}/benchmark/?${query.toString()}`;
}