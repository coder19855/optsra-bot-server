import { TradingStyle } from '../types/trading-style';
import { buildDeckTradePlanner } from './deck-trade-planner';

describe('buildDeckTradePlanner', () => {
  const setup = {
    entry: 25000,
    stopLoss: 24940,
    rawStopLoss: 24940,
    risk: 60,
    takeProfits: [
      { rr: '1:1' as const, multiplier: 1, price: 25060 },
      { rr: '1:2' as const, multiplier: 2, price: 25120 },
      { rr: '1:3' as const, multiplier: 3, price: 25180 },
    ],
    atrUsed: 45,
    stopAdjusted: false,
  };

  it('builds five lot scenarios in replay mode for a favorable CE setup', async () => {
    const planner = await buildDeckTradePlanner(
      {} as never,
      {
        symbol: 'NSE:NIFTY50-INDEX',
        tradingStyle: TradingStyle.Intraday,
        action: 'CE-BUY',
        conviction: 68,
        enterThreshold: 60,
        shouldConsiderTrade: true,
        tradeSetup: setup,
        exactStrike: {
          fyersSymbol: 'NSE:NIFTY2661625000CE',
          strike: 25000,
          moneyness: 'ATM',
          premium: 120,
          delta: 0.52,
          lotSize: 65,
          indexLabel: 'NIFTY',
          expectedPremiumMove50Pts: 26,
          rationale: 'ATM',
        },
        replayMode: true,
      },
    );

    expect(planner.favorable).toBe(true);
    expect(planner.suggestion).toBe('CE');
    expect(planner.scenarios).toHaveLength(5);
    expect(planner.scenarios[0].lots).toBe(1);
    expect(planner.scenarios[0].reward2RInr).toBe(
      planner.scenarios[0].reward1RInr * 2,
    );
    expect(planner.setup?.targets).toHaveLength(3);
  });

  it('marks unfavorable when conviction is below the enter bar', async () => {
    const planner = await buildDeckTradePlanner(
      {} as never,
      {
        symbol: 'NSE:NIFTY50-INDEX',
        tradingStyle: TradingStyle.Intraday,
        action: 'PE-BUY',
        conviction: 52,
        enterThreshold: 60,
        shouldConsiderTrade: true,
        tradeSetup: setup,
        replayMode: true,
      },
    );

    expect(planner.favorable).toBe(false);
    expect(planner.suggestion).toBe('PE');
    expect(planner.detail).toContain('below enter bar');
  });
});