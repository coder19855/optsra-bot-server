import { formatPatternBreakoutTelegramMessage } from './pattern-breakout-formatter';
import { TradingStyle } from '../types/trading-style';

describe('formatPatternBreakoutTelegramMessage', () => {
  it('formats a confirmed double bottom breakout', () => {
    const message = formatPatternBreakoutTelegramMessage({
      payload: {
        symbol: 'NSE:NIFTY50-INDEX',
        tradingStyle: TradingStyle.Intraday,
        lastPrice: 25088,
        action: 'NO-TRADE',
        bias: 'Moderate Bullish',
        conviction: 48,
        recommendation: 'Wait',
        humanSummary: '',
        tradeGuidance: { shouldConsiderTrade: false },
        priceAction: { action: 'NO-TRADE', confidence: 0 },
        recommendedStrategies: [],
        chartPattern: {
          pattern: 'double_bottom',
          status: 'confirmed',
          direction: 'bullish',
          neckline: 25040,
          timeframe: '15m',
        },
      },
    });

    expect(message).toContain('Chart pattern breakout');
    expect(message).toContain('double bottom');
    expect(message).toContain('Neckline 25,040');
  });

  it('shortens copy in compact mode', () => {
    const message = formatPatternBreakoutTelegramMessage({
      payload: {
        symbol: 'NSE:NIFTY50-INDEX',
        tradingStyle: TradingStyle.Intraday,
        lastPrice: 25088,
        action: 'NO-TRADE',
        bias: 'Moderate Bullish',
        conviction: 48,
        recommendation: 'Wait',
        humanSummary: '',
        tradeGuidance: { shouldConsiderTrade: false },
        priceAction: { action: 'NO-TRADE', confidence: 0 },
        recommendedStrategies: [],
        chartPattern: {
          pattern: 'range_breakout_bull',
          status: 'confirmed',
          direction: 'bullish',
          timeframe: '15m',
        },
      },
      alertFormat: 'compact',
    });

    expect(message).toContain('range breakout bull');
    expect(message).not.toContain('Separate from CE/PE');
  });
});