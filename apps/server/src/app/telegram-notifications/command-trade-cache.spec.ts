import {
  commandTradeCacheKey,
  clearCommandTradeCache,
  getRecentCommandTradeDecision,
  rememberCommandTradeDecision,
} from './command-trade-cache';
import { TradingStyle } from '../types/trading-style';
import { TradeDecisionAlertPayload } from '../types/telegram-notifications';

function samplePayload(): TradeDecisionAlertPayload {
  return {
    symbol: 'NSE:NIFTY50-INDEX',
    tradingStyle: TradingStyle.Intraday,
    lastPrice: 24000,
    action: 'CE-BUY',
    bias: 'Bullish',
    conviction: 70,
    recommendation: 'test',
    humanSummary: 'test',
    tradeGuidance: { shouldConsiderTrade: true },
    priceAction: { action: 'CE-BUY', confidence: 80 },
    recommendedStrategies: [],
  };
}

describe('command-trade-cache', () => {
  beforeEach(() => {
    clearCommandTradeCache();
  });

  it('returns payload within TTL', () => {
    const key = commandTradeCacheKey(
      'NSE:NIFTY50-INDEX',
      TradingStyle.Intraday,
      'strict',
      'blend',
    );
    const payload = samplePayload();
    rememberCommandTradeDecision(key, payload, 1_000);

    expect(getRecentCommandTradeDecision(key, 30_000, 10_000)).toBe(payload);
  });

  it('expires stale entries', () => {
    const key = commandTradeCacheKey(
      'NSE:NIFTY50-INDEX',
      TradingStyle.Intraday,
      'strict',
      'blend',
    );
    rememberCommandTradeDecision(key, samplePayload(), 0);

    expect(getRecentCommandTradeDecision(key, 30_000, 31_000)).toBeNull();
  });
});