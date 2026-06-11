import {
  buildOptionComponentGauges,
  buildPriceActionComponentGauges,
  buildReplayPaComponents,
} from './deck-components';

describe('deck-components', () => {
  it('maps explanation display names to canonical option keys', () => {
    const gauges = buildOptionComponentGauges([
      { name: 'OI Pressure Score', score: 0.4, interpretation: 'Bullish' },
      { name: 'Greeks Composite Score', score: -0.2 },
      { name: 'ATM IV Score', score: 0.1 },
    ]);

    expect(gauges[0]?.id).toBe('oi');
    expect(gauges.find((g) => g.id === 'greeks')?.value).toBeCloseTo(-0.2, 2);
    expect(gauges.find((g) => g.id === 'iv')?.value).toBeCloseTo(0.1, 2);
  });

  it('builds ordered option component gauges', () => {
    const gauges = buildOptionComponentGauges([
      { name: 'pcr', score: -0.3, interpretation: 'Neutral' },
      { name: 'oi', score: 0.5, interpretation: 'Bullish' },
      { name: 'greeks', score: -0.6 },
    ]);

    expect(gauges[0]?.id).toBe('oi');
    expect(gauges[0]?.value).toBeCloseTo(0.5, 2);
    expect(gauges.find((g) => g.id === 'pcr')?.value).toBeCloseTo(-0.3, 2);
  });

  it('builds price action timeframe gauges', () => {
    const gauges = buildPriceActionComponentGauges({
      '5m': { score: 0.2, weightage: 0.2 },
      '15m': { score: -0.4, weightage: 0.3 },
      '1h': { score: 0.1, weightage: 0.5 },
      alignment: { score: 3 },
    });

    expect(gauges.some((g) => g.id === '15m' && g.value < 0)).toBe(true);
    expect(gauges.some((g) => g.id === 'alignment')).toBe(true);
  });

  it('builds replay PA components from timeline scores', () => {
    const gauges = buildReplayPaComponents(
      { '5m': 0.3, '15m': -0.2, '1h': 0.1 },
      0.15,
      2,
    );
    expect(gauges.length).toBeGreaterThan(0);
    expect(gauges.find((g) => g.id === '5m')?.value).toBeCloseTo(0.3, 2);
  });
});