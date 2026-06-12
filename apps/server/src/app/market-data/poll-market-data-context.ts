import { PriceActionResponse } from '../types/technical-analysis';
import { TradingStyle } from '../types/trading-style';
import { VetoMode } from '../types/veto-mode';
import { TradeDecisionAlertPayload } from '../types/telegram-notifications';

export interface PollMarketDataContext {
  tradeDecisionCache: Map<string, TradeDecisionAlertPayload>;
  priceActionCache: Map<string, PriceActionResponse>;
}

export function createPollMarketDataContext(): PollMarketDataContext {
  return {
    tradeDecisionCache: new Map(),
    priceActionCache: new Map(),
  };
}

export function pollTradeDecisionCacheKey(
  symbol: string,
  tradingStyle: TradingStyle,
  vetoMode: VetoMode,
): string {
  return `${symbol}:${tradingStyle}:${vetoMode}`;
}

export function pollPriceActionCacheKey(
  symbol: string,
  tradingStyle: TradingStyle,
): string {
  return `${symbol}:${tradingStyle}`;
}