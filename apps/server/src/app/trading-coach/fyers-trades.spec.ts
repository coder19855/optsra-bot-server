import { CoachPnlSummary } from '../types/trading-coach';
import {
  resolveCoachBrokerNetPnlInr,
  resolveCoachDisplayPnlInr,
} from './fyers-trades';

function summary(
  overrides: Partial<CoachPnlSummary> = {},
): CoachPnlSummary {
  return {
    source: 'fyers_realised_profit_history',
    grossPnlInr: 0,
    netPnlInr: 0,
    chargesInr: 0,
    computedRoundTripPnlInr: 0,
    reconciled: false,
    ...overrides,
  };
}

describe('resolveCoachBrokerNetPnlInr', () => {
  it('returns broker net for account-wide header footnotes', () => {
    expect(
      resolveCoachBrokerNetPnlInr({
        pnlSummary: summary({ netPnlInr: -1673.75 }),
        symbolPnl: [],
        indexFilter: null,
      }),
    ).toBe(-1673.75);
  });
});

describe('resolveCoachDisplayPnlInr', () => {
  it('uses FIFO session PnL for live tradebook when broker figures diverge', () => {
    const total = resolveCoachDisplayPnlInr({
      fifoSessionPnlInr: 472,
      pnlSummary: summary({ grossPnlInr: -1600, netPnlInr: -1673.75 }),
      symbolPnl: [],
      indexFilter: null,
      tradeSource: 'fyers_tradebook',
    });

    expect(total).toBe(472);
  });

  it('prefers Fyers net PnL for reconciled trade history days', () => {
    const total = resolveCoachDisplayPnlInr({
      fifoSessionPnlInr: 472,
      pnlSummary: summary({
        grossPnlInr: 500,
        netPnlInr: 480,
        reconciled: true,
      }),
      symbolPnl: [],
      indexFilter: null,
      tradeSource: 'fyers_trade_history',
    });

    expect(total).toBe(480);
  });

  it('keeps FIFO closed-leg PnL when Fyers has not published figures yet', () => {
    const total = resolveCoachDisplayPnlInr({
      fifoSessionPnlInr: 472,
      pnlSummary: summary(),
      symbolPnl: [],
      indexFilter: null,
    });

    expect(total).toBe(472);
  });

  it('uses reconciled Fyers gross when FIFO matches', () => {
    const total = resolveCoachDisplayPnlInr({
      fifoSessionPnlInr: 500,
      pnlSummary: summary({
        grossPnlInr: 500,
        netPnlInr: 480,
        reconciled: true,
      }),
      symbolPnl: [],
      indexFilter: null,
    });

    expect(total).toBe(480);
  });
});