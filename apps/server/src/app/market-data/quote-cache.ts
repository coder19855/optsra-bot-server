import { FYERS_MARKET_STREAM_DEFAULTS } from '../constants/fyers-market-stream';

export interface LiveQuote {
  symbol: string;
  ltp: number;
  ch: number;
  chp: number;
  updatedAt: number;
  source: 'ws' | 'rest';
}

export interface SpotRingPoint {
  t: number;
  v: number;
}

export interface QuoteCacheStats {
  quoteCount: number;
  wsUpdates: number;
  restSeeds: number;
  ringSymbols: number;
}

export class QuoteCache {
  private quotes = new Map<string, LiveQuote>();
  private spotRings = new Map<string, SpotRingPoint[]>();
  private wsUpdates = 0;
  private restSeeds = 0;

  upsert(
    tick: Omit<LiveQuote, 'updatedAt'> & { updatedAt?: number },
    nowMs = Date.now(),
  ): LiveQuote {
    const prev = this.quotes.get(tick.symbol);
    const entry: LiveQuote = {
      symbol: tick.symbol,
      ltp: tick.ltp,
      ch: tick.ch,
      chp: tick.chp,
      updatedAt: tick.updatedAt ?? nowMs,
      source: tick.source,
    };
    this.quotes.set(tick.symbol, entry);

    if (tick.source === 'ws') {
      this.wsUpdates += 1;
    } else {
      this.restSeeds += 1;
    }

    if (prev && tick.source === 'ws') {
      this.appendSpotRing(tick.symbol, entry.ltp, entry.updatedAt);
    } else if (tick.source === 'ws') {
      this.appendSpotRing(tick.symbol, entry.ltp, entry.updatedAt);
    }

    return entry;
  }

  get(symbol: string): LiveQuote | null {
    return this.quotes.get(symbol) ?? null;
  }

  getLtp(
    symbol: string,
    maxAgeMs = FYERS_MARKET_STREAM_DEFAULTS.QUOTE_MAX_AGE_MS,
    nowMs = Date.now(),
  ): number | null {
    const quote = this.quotes.get(symbol);
    if (!quote) return null;
    if (nowMs - quote.updatedAt > maxAgeMs) return null;
    return quote.ltp > 0 ? quote.ltp : null;
  }

  private appendSpotRing(symbol: string, ltp: number, atMs: number): void {
    if (!symbol.includes('-INDEX')) return;

    const ring = this.spotRings.get(symbol) ?? [];
    const last = ring[ring.length - 1];
    if (last && atMs - last.t < 1000) {
      last.v = ltp;
      last.t = atMs;
    } else {
      ring.push({ t: atMs, v: ltp });
    }

    const maxAge = FYERS_MARKET_STREAM_DEFAULTS.SPOT_RING_MAX_AGE_MS;
    const cutoff = atMs - maxAge;
    while (ring.length > 0 && ring[0].t < cutoff) {
      ring.shift();
    }
    while (
      ring.length > FYERS_MARKET_STREAM_DEFAULTS.SPOT_RING_MAX_POINTS
    ) {
      ring.shift();
    }

    this.spotRings.set(symbol, ring);
  }

  getSpotRing(
    indexSymbol: string,
    maxAgeMs = FYERS_MARKET_STREAM_DEFAULTS.SPOT_RING_MAX_AGE_MS,
    nowMs = Date.now(),
  ): SpotRingPoint[] {
    const ring = this.spotRings.get(indexSymbol) ?? [];
    const cutoff = nowMs - maxAgeMs;
    return ring.filter((p) => p.t >= cutoff);
  }

  getStats(): QuoteCacheStats {
    return {
      quoteCount: this.quotes.size,
      wsUpdates: this.wsUpdates,
      restSeeds: this.restSeeds,
      ringSymbols: this.spotRings.size,
    };
  }

  resetForTests(): void {
    this.quotes.clear();
    this.spotRings.clear();
    this.wsUpdates = 0;
    this.restSeeds = 0;
  }
}

let singleton: QuoteCache | null = null;

export function getQuoteCache(): QuoteCache {
  if (!singleton) singleton = new QuoteCache();
  return singleton;
}

export function resetQuoteCacheForTests(): void {
  if (singleton) singleton.resetForTests();
}