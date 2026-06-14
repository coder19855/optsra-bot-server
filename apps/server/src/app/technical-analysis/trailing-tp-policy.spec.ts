import {
  buildTrailingTpHoldGuidance,
  evaluateTrailingTpState,
  resolveTrailFloorR,
} from './trailing-tp-policy';
import { buildBenchmarkTradeSetup } from '../benchmark/benchmark-trade-setup';

describe('trailing-tp-policy', () => {
  const setup = buildBenchmarkTradeSetup('CE-BUY', 100, 95, 10)!;

  it('locks floor at 1:4 once 1:4 is touched (not 1:2.5)', () => {
    expect(resolveTrailFloorR(4)).toBe(4);
    expect(resolveTrailFloorR(4.2)).toBe(4);
  });

  it('ratchets floor at peakR − 1R beyond 1:4', () => {
    expect(resolveTrailFloorR(7)).toBe(6);
    expect(resolveTrailFloorR(5)).toBe(4);
  });

  it('tracks peak R and dynamic floor after 1:4 extension', () => {
    const tp4 = setup.takeProfits.find((t) => t.rr === '1:4')!.price;
    const state = evaluateTrailingTpState('CE-BUY', tp4 + 2 * setup.risk, setup, '1:4', 4);
    expect(state.peakR).toBeGreaterThanOrEqual(6);
    expect(state.lockedFloorR).toBeGreaterThanOrEqual(5);
    expect(state.extensionPastMaxTp).toBe(true);
  });

  it('advises dynamic trail past 1:4 instead of hard exit', () => {
    const tp4 = setup.takeProfits.find((t) => t.rr === '1:4')!.price;
    const trailing = evaluateTrailingTpState('CE-BUY', tp4 + setup.risk, setup, '1:4', 5);
    const guidance = buildTrailingTpHoldGuidance({
      conviction: 72,
      enterThreshold: 60,
      strongThreshold: 70,
      momentumDecayPercent: 10,
      trailing,
      nextTpRr: null,
      currentR: 5,
      approaching: false,
      oppositeFlipConfirmed: false,
      peakLockedForFlip: true,
    });
    expect(guidance.holdAdvice).toBe('trail');
    expect(guidance.holdHeadline).toContain('peak');
  });
});