import { parseWsTicks } from './parse-ws-tick';

describe('parseWsTicks', () => {
  it('parses single symbol update objects', () => {
    const ticks = parseWsTicks(
      {
        symbol: 'NSE:NIFTY50-INDEX',
        ltp: 24500.5,
        ch: 12,
        chp: 0.05,
      },
      1_700_000_000_000,
    );

    expect(ticks).toHaveLength(1);
    expect(ticks[0]).toMatchObject({
      symbol: 'NSE:NIFTY50-INDEX',
      ltp: 24500.5,
      ch: 12,
      chp: 0.05,
      source: 'ws',
    });
  });

  it('parses symbol-keyed maps', () => {
    const ticks = parseWsTicks({
      'NSE:NIFTY2661623200CE': { ltp: 132.5, ch: 2, chp: 1.5 },
    });

    expect(ticks[0]?.symbol).toBe('NSE:NIFTY2661623200CE');
    expect(ticks[0]?.ltp).toBe(132.5);
  });
});