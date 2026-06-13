import { TradeDecisionAlertPayload } from '../types/telegram-notifications';
import { pollTradeDecisionCacheKey } from '../market-data/poll-market-data-context';
import { FlowMode } from '../types/flow-mode';
import { VetoMode } from '../types/veto-mode';
import { TradingStyle } from '../types/trading-style';

const COMMAND_TRADE_CACHE_TTL_MS = 30_000;

interface CacheEntry {
  payload: TradeDecisionAlertPayload;
  fetchedAt: number;
}

const commandTradeCache = new Map<string, CacheEntry>();

export function commandTradeCacheKey(
  symbol: string,
  tradingStyle: TradingStyle,
  vetoMode: VetoMode,
  flowMode: FlowMode,
): string {
  return pollTradeDecisionCacheKey(symbol, tradingStyle, vetoMode, flowMode);
}

export function rememberCommandTradeDecision(
  key: string,
  payload: TradeDecisionAlertPayload,
  fetchedAt = Date.now(),
): void {
  commandTradeCache.set(key, { payload, fetchedAt });
}

export function getRecentCommandTradeDecision(
  key: string,
  maxAgeMs = COMMAND_TRADE_CACHE_TTL_MS,
  nowMs = Date.now(),
): TradeDecisionAlertPayload | null {
  const entry = commandTradeCache.get(key);
  if (!entry) return null;
  if (nowMs - entry.fetchedAt > maxAgeMs) return null;
  return entry.payload;
}

export function clearCommandTradeCache(): void {
  commandTradeCache.clear();
}