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
  /** Cached report from a completed /benchmark run — opens instantly without re-replay. */
  reportId?: string;
  symbol: string;
  tradingStyle: string;
  days?: number;
  aiMode?: string;
  maxTradesPerDay?: number;
}): string | null {
  const base = resolveDeckBaseUrl();
  if (!base) return null;

  const query = new URLSearchParams();
  if (params.reportId?.trim()) {
    query.set('reportId', params.reportId.trim());
  } else {
    query.set('symbol', params.symbol);
    query.set('style', params.tradingStyle);
    query.set('days', String(params.days ?? 14));
    query.set('aiMode', params.aiMode ?? 'shadow');
    if (params.maxTradesPerDay != null) {
      query.set('maxTrades', String(params.maxTradesPerDay));
    }
  }
  return `${base}/benchmark/?${query.toString()}`;
}