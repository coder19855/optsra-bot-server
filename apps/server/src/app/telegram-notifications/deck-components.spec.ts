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

  it('shows alignment as X/3 and positive 1h vs primary on NO-TRADE', () => {
    const gauges = buildPriceActionComponentGauges(
      {
        '5m': { score: 0.2 },
        '15m': { score: 0.15 },
        '1h': { score: 0.42 },
        alignment: { score: 3 },
        higherTFConfirmation: { score: 1 },
      },
      { primaryTimeframe: '15m' },
    );

    const alignment = gauges.find((g) => g.id === 'alignment');
    const higherTf = gauges.find((g) => g.id === 'higherTFConfirmation');

    expect(alignment?.readout).toBe('3/3');
    expect(alignment?.value).toBeCloseTo(1, 2);
    expect(higherTf?.readout).toBe('supports');
    expect(higherTf?.value).toBeGreaterThan(0.5);
  });

  it('shows lean + for 1h when structure supports primary but gate is off', () => {
    const gauges = buildPriceActionComponentGauges(
      {
        '5m': { score: 0.1 },
        '15m': { score: 0.2 },
        '1h': { score: 0.42 },
        alignment: { score: 3 },
        higherTFConfirmation: { score: 0 },
      },
      { primaryTimeframe: '15m' },
    );

    const higherTf = gauges.find((g) => g.id === 'higherTFConfirmation');
    expect(higherTf?.readout).toBe('lean +');
    expect(higherTf?.value).toBeGreaterThan(0.3);
  });

  it('builds replay PA components from timeline scores', () => {
    const gauges = buildReplayPaComponents(
      { '5m': 0.3, '15m': -0.2, '1h': 0.1 },
      0.15,
      2,
      '15m',
    );
    expect(gauges.length).toBeGreaterThan(0);
    expect(gauges.find((g) => g.id === '5m')?.value).toBeCloseTo(0.3, 2);
    expect(gauges.find((g) => g.id === 'alignment')?.readout).toBe('2/3');
  });
});