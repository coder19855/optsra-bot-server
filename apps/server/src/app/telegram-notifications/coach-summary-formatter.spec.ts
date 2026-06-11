import { TradingCoachResponse } from '../types/trading-coach';
import { TradingStyle } from '../types/trading-style';
import { formatTelegramCoachSummaryMessage } from './coach-summary-formatter';

function minimalCoach(
  overrides: Partial<TradingCoachResponse> = {},
): TradingCoachResponse {
  return {
    source: 'fyers_tradebook',
    dateRange: { fromDate: null, toDate: null },
    rawFillCount: 2,
    disclaimer: 'test',
    tradingStyle: TradingStyle.Intraday,
    indexFilter: null,
    sessionDateFilter: null,
    generatedAt: new Date().toISOString(),
    summary: {
      totalRoundTrips: 1,
      analyzed: 1,
      skipped: 0,
      internalCarryFillsExcluded: 0,
      verdicts: { good: 1, bad: 0, ugly: 0 },
      totalPnlInr: 472,
      computedRoundTripPnlInr: 472,
      systemApprovedCount: 0,
      winCount: 1,
      lossCount: 0,
      openPositionCount: 1,
    },
    pnlSummary: {
      source: 'fyers_realised_profit_history',
      grossPnlInr: -1600,
      netPnlInr: -1673.75,
      chargesInr: 73.75,
      computedRoundTripPnlInr: 472,
      reconciled: false,
    },
    symbolPnl: [],
    openPositions: [
      {
        optionSymbol: 'NSE:NIFTY2661623150PE',
        indexSymbol: 'NSE:NIFTY50-INDEX',
        underlying: 'NIFTY',
        optionType: 'PE',
        direction: 'PE-BUY',
        qty: 75,
        avgEntryPremium: 120,
        entryAtMs: Date.parse('2026-06-11T09:37:00+05:30'),
        entryAtISO: '2026-06-11T09:37:00.000+05:30',
        sessionDate: '2026-06-11',
        entryFills: [],
      },
    ],
    trades: [
      {
        trade: {
          id: 'leg-1',
          optionSymbol: 'NSE:NIFTY2661623200PE',
          indexSymbol: 'NSE:NIFTY50-INDEX',
          underlying: 'NIFTY',
          optionType: 'PE',
          direction: 'PE-BUY',
          entryAtMs: Date.parse('2026-06-11T09:16:00+05:30'),
          exitAtMs: Date.parse('2026-06-11T10:12:00+05:30'),
          entryAtISO: '2026-06-11T09:16:00.000+05:30',
          exitAtISO: '2026-06-11T10:12:00.000+05:30',
          sessionDate: '2026-06-11',
          qty: 75,
          entryPremium: 100,
          exitPremium: 110,
          pnlInr: 750,
          pnlPremium: 10,
          productType: 'INTRADAY',
          entryFills: [],
          exitFills: [],
        },
        tradingStyle: TradingStyle.Intraday,
        replay: {
          mode: 'price_action_only',
          note: 'test',
          preTradeMinutes: 30,
          postTradeMinutes: 30,
          preTrade: [],
          atEntry: null,
          atExit: null,
          expectedOutcome: null,
          excursion: null,
          postExit: null,
        },
        analysis: {
          systemApproved: false,
          entryQuality: 'weak',
          exitQuality: 'acceptable',
          verdict: 'good',
          tags: ['lucky_override'],
          coaching: ['Discretionary win'],
        },
      },
    ],
    skippedTrades: [],
    ...overrides,
  };
}

describe('formatTelegramCoachSummaryMessage', () => {
  it('does not double-count PnL across multiple coached styles', () => {
    const coach = minimalCoach();
    const message = formatTelegramCoachSummaryMessage({
      sessionDate: '2026-06-11',
      coaches: [coach, { ...coach, tradingStyle: TradingStyle.Scalper }],
      snapshots: [],
    });

    expect(message.match(/PnL:<\/b>/g)?.length).toBe(1);
    expect(message).toContain('PnL:</b> +₹472');
  });

  it('shows session PnL, broker reference, open positions, and entry→exit times', () => {
    const message = formatTelegramCoachSummaryMessage({
      sessionDate: '2026-06-11',
      coaches: [minimalCoach()],
      snapshots: [],
    });

    expect(message).toContain('PnL:</b> +₹472');
    expect(message).toContain('Fyers account net');
    expect(message).toContain('1,673.75');
    expect(message).not.toContain('Closed legs only');
    expect(message).toContain('Still open');
    expect(message).toContain('NIFTY2661623150PE');
    expect(message).toContain('09:16→10:12');
    expect(message).toContain('75 qty');
  });
});