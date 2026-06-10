import { formatThetaDecayLabel } from './greeks-moneyness-insight';

describe('formatThetaDecayLabel', () => {
  it('hides near-zero decay', () => {
    expect(formatThetaDecayLabel(0, 65)).toBeNull();
    expect(formatThetaDecayLabel(0.001, 65)).toBeNull();
  });

  it('shows per-lot decay for realistic theta', () => {
    expect(formatThetaDecayLabel(-1.2, 65)).toBe('₹78.0/lot·day');
  });
});