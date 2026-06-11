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