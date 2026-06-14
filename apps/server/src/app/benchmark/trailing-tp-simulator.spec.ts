import { simulateTradeOutcomeWithTrailingFloor } from './trailing-tp-simulator';
import { buildBenchmarkTradeSetup } from './benchmark-trade-setup';

describe('simulateTradeOutcomeWithTrailingFloor', () => {
  const setup = buildBenchmarkTradeSetup('CE-BUY', 100, 95, 10)!;
  const tp1 = setup.takeProfits.find((t) => t.multiplier === 1.5)!.price;
  const tp2 = setup.takeProfits.find((t) => t.multiplier === 2.5)!.price;
  const tp3 = setup.takeProfits.find((t) => t.multiplier === 4)!.price;

  it('exits at stop loss when hit before TP', () => {
    const forward = [
      [1, 100, 101, 94, 96, 0],
      [2, 96, 97, 93, 94, 0],
    ] as any;
    const outcome = simulateTradeOutcomeWithTrailingFloor('CE-BUY', setup, forward);
    expect(outcome.status).toBe('STOP_LOSS');
    expect(outcome.hitLevel).toBe('STOP_LOSS');
  });

  it('holds through 1:1.5 and exits at 1:2.5 floor on reversal', () => {
    expect(setup.risk).toBe(5);
    expect(tp1).toBe(107.5);
    expect(tp2).toBe(112.5);
    const forward = [
      [1, 100, tp1 + 0.5, 99, 100.5, 0],
      [2, 100.5, tp2 + 0.2, 100, tp2 - 0.05, 0],
      [3, tp2 - 0.1, tp2 - 0.05, tp2 - 0.6, tp2 - 0.4, 0],
    ] as any;
    const outcome = simulateTradeOutcomeWithTrailingFloor('CE-BUY', setup, forward);
    expect(outcome.status).toBe('TAKE_PROFIT');
    expect(outcome.hitLevel).toBe('1:2.5');
  });

  it('exits at 1:4 floor (not 1:2.5) after 1:4 extension reverses', () => {
    const forward = [
      [1, 100, tp3 + 0.5, 99, tp3, 0],
      [2, tp3, tp3 + 0.2, tp3 - 1.5, tp3 - 1, 0],
    ] as any;
    const outcome = simulateTradeOutcomeWithTrailingFloor('CE-BUY', setup, forward);
    expect(outcome.status).toBe('TAKE_PROFIT');
    expect(outcome.hitLevel).toBe('1:4');
    expect(outcome.pnlR).toBe(4);
  });

  it('ratchets floor to 6R when peak reaches 7R', () => {
    const peak7 = setup.entry + setup.risk * 7;
    const floor6 = setup.entry + setup.risk * 6;
    const forward = [
      [1, 100, peak7, 99, peak7, 0],
      [2, peak7, peak7, floor6 - 0.5, floor6 - 0.2, 0],
    ] as any;
    const outcome = simulateTradeOutcomeWithTrailingFloor('CE-BUY', setup, forward);
    expect(outcome.status).toBe('TAKE_PROFIT');
    expect(outcome.hitLevel).toBe('TRAIL_FLOOR');
    expect(outcome.pnlR).toBe(6);
  });

  it('holds past 1:4 without auto-exit until session end', () => {
    const forward = [
      [1, 100, tp1, 99, 100, 0],
      [2, 100, tp3 + 1, tp2, tp3 + 0.5, 0],
    ] as any;
    const outcome = simulateTradeOutcomeWithTrailingFloor('CE-BUY', setup, forward);
    expect(outcome.status).toBe('SESSION_END');
    expect(outcome.hitLevel).toBe('1:4');
    expect(outcome.pnlR).toBeGreaterThan(3);
  });

  it('exits on confirmed signal flip when 1:1.5 is locked', () => {
    const forward = [
      [1, 100, tp1 + 0.5, 99, 100.5, 0],
      [2, 100.5, tp1 + 0.2, 100, 104, 0],
    ] as any;
    const outcome = simulateTradeOutcomeWithTrailingFloor('CE-BUY', setup, forward, 'session', {
      flipExits: [{ tsMs: 2000, oppositeAction: 'PE-BUY', conviction: 72 }],
    });
    expect(outcome.hitLevel).toBe('SIGNAL_FLIP');
    expect(outcome.exitPrice).toBe(104);
    expect(outcome.pnlR).toBeGreaterThan(0);
  });

  it('ignores flip before 1:1.5 is locked', () => {
    const forward = [
      [1, 100, 100.5, 99, 100.2, 0],
      [2, 100.2, 100.4, 100, 104, 0],
    ] as any;
    const outcome = simulateTradeOutcomeWithTrailingFloor('CE-BUY', setup, forward, 'session', {
      flipExits: [{ tsMs: 2000, oppositeAction: 'PE-BUY', conviction: 72 }],
    });
    expect(outcome.hitLevel).not.toBe('SIGNAL_FLIP');
  });
});