import { FastifyBaseLogger } from 'fastify';
import {
  FYERS_MARKET_STREAM_DEFAULTS,
  resolveFyersWsLiteMode,
} from '../constants/fyers-market-stream';
import {
  createFyersDataSocket,
  DataSocketLike,
} from './fyers-data-socket-adapter';
import { parseWsTicks } from './parse-ws-tick';
import {
  patchOptionChainWithLiveQuotes,
  seedQuotesFromOptionChain,
} from './option-chain-patch';
import { getQuoteCache, QuoteCacheStats } from './quote-cache';
import {
  diffSymbolSets,
  symbolsFromOptionChain,
} from './subscription-symbols';
import { FyersAPI } from 'fyers-api-v3';

export interface MarketStreamStats {
  enabled: boolean;
  connected: boolean;
  desiredSymbols: number;
  activeSymbols: number;
  messages: number;
  lastMessageAt: string | null;
  lastError: string | null;
  quoteCache: QuoteCacheStats;
}

export class FyersMarketStreamManager {
  private socket: DataSocketLike | null = null;
  private desiredSymbols = new Set<string>();
  private activeSymbols = new Set<string>();
  private connected = false;
  private messages = 0;
  private lastMessageAt: number | null = null;
  private lastError: string | null = null;
  private accessTokenKey = '';

  constructor(private readonly log: FastifyBaseLogger) {}

  getIndexLtp(indexSymbol: string, nowMs = Date.now()): number | null {
    return getQuoteCache().getLtp(indexSymbol, undefined, nowMs);
  }

  getOptionLtp(optionSymbol: string, nowMs = Date.now()): number | null {
    return getQuoteCache().getLtp(optionSymbol, undefined, nowMs);
  }

  getSpotSeries(
    indexSymbol: string,
    maxAgeMs = FYERS_MARKET_STREAM_DEFAULTS.SPOT_RING_MAX_AGE_MS,
    nowMs = Date.now(),
  ) {
    return getQuoteCache().getSpotRing(indexSymbol, maxAgeMs, nowMs);
  }

  addWatchIndexSymbols(symbols: string[]): void {
    for (const symbol of symbols) {
      this.desiredSymbols.add(symbol);
      this.desiredSymbols.add(FYERS_MARKET_STREAM_DEFAULTS.INDIA_VIX_SYMBOL);
    }
    this.reconcileSubscriptions();
  }

  syncOpenOutcomeSymbols(symbols: string[]): void {
    for (const symbol of symbols) {
      if (symbol) this.desiredSymbols.add(symbol);
    }
    this.reconcileSubscriptions();
  }

  onOptionChainFetched(
    indexSymbol: string,
    response: FyersAPI.OptionChainResponse,
  ): void {
    seedQuotesFromOptionChain(response);
    for (const symbol of symbolsFromOptionChain(response, indexSymbol)) {
      this.desiredSymbols.add(symbol);
    }
    this.reconcileSubscriptions();
  }

  async connect(accessToken: string, appId: string): Promise<void> {
    const tokenKey = `${appId}:${accessToken.slice(0, 12)}`;
    if (this.socket && this.connected && this.accessTokenKey === tokenKey) {
      return;
    }

    await this.disconnect();

    this.accessTokenKey = tokenKey;
    const auth = `${appId}:${accessToken}`;
    const socket = createFyersDataSocket(auth, '', false);
    this.socket = socket;

    socket.on('connect', () => {
      this.connected = true;
      this.lastError = null;
      this.log.info('Fyers market data WebSocket connected');
      if (resolveFyersWsLiteMode() && socket.LiteMode != null) {
        socket.mode(socket.LiteMode);
      }
      this.reconcileSubscriptions(true);
    });

    socket.on('message', (message: unknown) => {
      this.messages += 1;
      this.lastMessageAt = Date.now();
      for (const tick of parseWsTicks(message, this.lastMessageAt)) {
        getQuoteCache().upsert(tick, this.lastMessageAt);
      }
    });

    socket.on('error', (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.lastError = msg;
      this.log.warn({ err }, 'Fyers market data WebSocket error');
    });

    socket.on('close', () => {
      this.connected = false;
      this.activeSymbols.clear();
      this.log.info('Fyers market data WebSocket closed');
    });

    const reconnect = socket.autoReconnect ?? socket.autoreconnect;
    reconnect?.call(socket, FYERS_MARKET_STREAM_DEFAULTS.AUTO_RECONNECT_TRIES);

    socket.connect();
  }

  async disconnect(): Promise<void> {
    if (!this.socket) return;
    try {
      this.socket.close?.();
    } catch {
      // ignore close errors during teardown
    }
    this.socket = null;
    this.connected = false;
    this.activeSymbols.clear();
    this.accessTokenKey = '';
  }

  isConnected(): boolean {
    return this.connected || Boolean(this.socket?.isConnected?.());
  }

  getStats(enabled: boolean): MarketStreamStats {
    return {
      enabled,
      connected: this.isConnected(),
      desiredSymbols: this.desiredSymbols.size,
      activeSymbols: this.activeSymbols.size,
      messages: this.messages,
      lastMessageAt: this.lastMessageAt
        ? new Date(this.lastMessageAt).toISOString()
        : null,
      lastError: this.lastError,
      quoteCache: getQuoteCache().getStats(),
    };
  }

  private reconcileSubscriptions(force = false): void {
    if (!this.socket || !this.connected) return;

    const { subscribe, unsubscribe } = diffSymbolSets(
      this.desiredSymbols,
      this.activeSymbols,
    );

    if (!force && subscribe.length === 0 && unsubscribe.length === 0) return;

    if (unsubscribe.length > 0) {
      try {
        this.socket.unsubscribe(unsubscribe);
        for (const symbol of unsubscribe) {
          this.activeSymbols.delete(symbol);
        }
      } catch (err) {
        this.log.warn({ err, count: unsubscribe.length }, 'WS unsubscribe failed');
      }
    }

    if (subscribe.length > 0) {
      try {
        this.socket.subscribe(subscribe);
        for (const symbol of subscribe) {
          this.activeSymbols.add(symbol);
        }
        this.log.debug(
          { added: subscribe.length, total: this.activeSymbols.size },
          'WS symbols subscribed',
        );
      } catch (err) {
        this.log.warn({ err, count: subscribe.length }, 'WS subscribe failed');
      }
    }
  }
}

export function patchCachedOptionChain(
  response: FyersAPI.OptionChainResponse,
): FyersAPI.OptionChainResponse {
  return patchOptionChainWithLiveQuotes(response);
}