import { TradingStyle } from '../types/trading-style';
import {
  buildPatternBreakoutKey,
  detectChartPatternBreakout,
} from './pattern-breakout-tracker';
import { SignalSnapshot } from '../types/telegram-notifications';

function snap(
  overrides: Partial<SignalSnapshot> = {},
): SignalSnapshot {
  return {
    key: 'NSE:NIFTY50-INDEX:INTRADAY',
    symbol: 'NSE:NIFTY50-INDEX',
    tradingStyle: TradingStyle.Intraday,
    action: 'NO-TRADE',
    paAction: 'NO-TRADE',
    bias: 'Moderate Bearish',
    conviction: 40,
    shouldConsiderTrade: false,
    topStrategy: null,
    lastPrice: 25000,
    recommendation: 'Wait',
    humanSummary: '',
    fingerprint: 'x',
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('detectChartPatternBreakout', () => {
  it('fires on forming → confirmed neckline break', () => {
    const previous = snap({
      chartPattern: 'double_bottom',
      chartPatternStatus: 'forming',
      chartPatternTimeframe: '15m',
    });
    const current = snap({
      chartPattern: 'double_bottom',
      chartPatternStatus: 'confirmed',
      chartPatternTimeframe: '15m',
    });

    expect(detectChartPatternBreakout(previous, current)).toEqual({
      shouldNotify: true,
      breakoutKey: buildPatternBreakoutKey({
        pattern: 'double_bottom',
        status: 'confirmed',
        timeframe: '15m',
      }),
    });
  });

  it('fires on fresh range breakout', () => {
    const previous = snap({ chartPattern: 'none', chartPatternStatus: undefined });
    const current = snap({
      chartPattern: 'range_breakout_bull',
      chartPatternStatus: 'confirmed',
      chartPatternTimeframe: '15m',
    });

    expect(detectChartPatternBreakout(previous, current).shouldNotify).toBe(true);
  });

  it('dedupes repeated confirmed polls', () => {
    const key = buildPatternBreakoutKey({
      pattern: 'double_top',
      status: 'confirmed',
      timeframe: '15m',
    });
    const previous = snap({
      chartPattern: 'double_top',
      chartPatternStatus: 'confirmed',
      chartPatternTimeframe: '15m',
      lastNotifiedPatternBreakoutKey: key,
    });
    const current = snap({
      chartPattern: 'double_top',
      chartPatternStatus: 'confirmed',
      chartPatternTimeframe: '15m',
    });

    expect(detectChartPatternBreakout(previous, current).shouldNotify).toBe(false);
  });

  it('skips when no previous snapshot', () => {
    const current = snap({
      chartPattern: 'range_breakout_bear',
      chartPatternStatus: 'confirmed',
    });
    expect(detectChartPatternBreakout(null, current).shouldNotify).toBe(false);
  });

  it('fires on bull flag forming → confirmed', () => {
    const previous = snap({
      chartPattern: 'bull_flag',
      chartPatternStatus: 'forming',
      chartPatternTimeframe: '15m',
    });
    const current = snap({
      chartPattern: 'bull_flag',
      chartPatternStatus: 'confirmed',
      chartPatternTimeframe: '15m',
    });

    expect(detectChartPatternBreakout(previous, current).shouldNotify).toBe(true);
  });
});