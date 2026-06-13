import { FyersAPI } from 'fyers-api-v3';
import {
  MARKET_DATA_CACHE_DEFAULTS,
  resolveCandleCacheTtl5mMs,
  resolveCandleCacheTtlHigherMs,
  resolveOptionChainCacheTtlMs,
} from '../constants/market-data-cache';
import { notifyOptionChainFetched } from './market-stream-coordinator';
import { patchOptionChainWithLiveQuotes } from './option-chain-patch';

interface CacheEntry<T> {
  value: T;
  fetchedAt: number;
}

export interface MarketDataCacheStats {
  historyHits: number;
  historyMisses: number;
  optionChainHits: number;
  optionChainMisses: number;
  historyEntries: number;
  optionChainEntries: number;
}

function isLiveHistoryQuery(
  rangeTo: string,
  nowMs = Date.now(),
): boolean {
  const rangeToMs = Number(rangeTo) * 1000;
  if (!Number.isFinite(rangeToMs)) return true;
  return (
    Math.abs(nowMs - rangeToMs) <=
    MARKET_DATA_CACHE_DEFAULTS.LIVE_HISTORY_TOLERANCE_MS
  );
}

function historyCacheKey(
  params: FyersAPI.HistoryQueryRequest,
  nowMs = Date.now(),
): string {
  if (isLiveHistoryQuery(params.range_to, nowMs)) {
    return `live:${params.symbol}:${params.resolution}`;
  }
  return `hist:${params.symbol}:${params.resolution}:${params.range_from}:${params.range_to}`;
}

function ttlForResolution(resolution: string): number {
  return resolution === '5'
    ? resolveCandleCacheTtl5mMs()
    : resolveCandleCacheTtlHigherMs();
}

function optionChainCacheKey(params: FyersAPI.OptionChainRequest): string {
  return `${params.symbol}:${params.strikecount}:${params.greeks}`;
}

export class MarketDataStore {
  private historyCache = new Map<string, CacheEntry<FyersAPI.HistoryResponse>>();
  private optionChainCache = new Map<
    string,
    CacheEntry<FyersAPI.OptionChainResponse>
  >();
  private historyHits = 0;
  private historyMisses = 0;
  private optionChainHits = 0;
  private optionChainMisses = 0;

  async getHistory(
    params: FyersAPI.HistoryQueryRequest,
    fetch: () => Promise<FyersAPI.HistoryResponse>,
    nowMs = Date.now(),
  ): Promise<FyersAPI.HistoryResponse> {
    const key = historyCacheKey(params, nowMs);
    const cached = this.historyCache.get(key);
    const ttl = ttlForResolution(params.resolution);

    if (cached && nowMs - cached.fetchedAt < ttl) {
      this.historyHits += 1;
      return cached.value;
    }

    this.historyMisses += 1;
    const value = await fetch();
    if (value.s === 'ok') {
      this.historyCache.set(key, { value, fetchedAt: nowMs });
    }
    return value;
  }

  async getOptionChain(
    params: FyersAPI.OptionChainRequest,
    fetch: () => Promise<FyersAPI.OptionChainResponse>,
    nowMs = Date.now(),
  ): Promise<FyersAPI.OptionChainResponse> {
    const key = optionChainCacheKey(params);
    const cached = this.optionChainCache.get(key);
    const ttl = resolveOptionChainCacheTtlMs();

    if (cached && nowMs - cached.fetchedAt < ttl) {
      this.optionChainHits += 1;
      return patchOptionChainWithLiveQuotes(cached.value, nowMs);
    }

    this.optionChainMisses += 1;
    const value = await fetch();
    if (value.s === 'ok') {
      this.optionChainCache.set(key, { value, fetchedAt: nowMs });
      notifyOptionChainFetched(params.symbol, value);
    }
    return patchOptionChainWithLiveQuotes(value, nowMs);
  }

  getStats(): MarketDataCacheStats {
    return {
      historyHits: this.historyHits,
      historyMisses: this.historyMisses,
      optionChainHits: this.optionChainHits,
      optionChainMisses: this.optionChainMisses,
      historyEntries: this.historyCache.size,
      optionChainEntries: this.optionChainCache.size,
    };
  }

  resetForTests(): void {
    this.historyCache.clear();
    this.optionChainCache.clear();
    this.historyHits = 0;
    this.historyMisses = 0;
    this.optionChainHits = 0;
    this.optionChainMisses = 0;
  }
}

let singletonStore: MarketDataStore | null = null;

export function getMarketDataStore(): MarketDataStore {
  if (!singletonStore) {
    singletonStore = new MarketDataStore();
  }
  return singletonStore;
}

export function resetMarketDataStoreForTests(): void {
  if (singletonStore) {
    singletonStore.resetForTests();
  }
}