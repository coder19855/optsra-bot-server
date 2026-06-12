import {
  alignmentToGaugeValue,
  countAlignedTimeframes,
  higherTfToGaugeValue,
  isHigherTfSupportive,
} from './timeframe-alignment';

describe('timeframe-alignment', () => {
  it('counts TFs aligned with primary score direction on NO-TRADE days', () => {
    const aligned = countAlignedTimeframes(
      { '5m': 0.2, '15m': 0.15, '1h': 0.42 },
      '15m',
    );
    expect(aligned).toBe(3);
  });

  it('treats flat primary as aligned with every TF', () => {
    const aligned = countAlignedTimeframes(
      { '5m': 0.1, '15m': 0, '1h': -0.1 },
      '15m',
    );
    expect(aligned).toBe(3);
  });

  it('detects 1h support for primary intraday direction', () => {
    expect(
      isHigherTfSupportive(
        { '5m': 0.1, '15m': 0.2, '1h': 0.42 },
        '15m',
      ),
    ).toBe(true);
  });

  it('maps alignment count to gauge and higher TF tri-state', () => {
    expect(alignmentToGaugeValue(3)).toBeCloseTo(1, 2);
    expect(alignmentToGaugeValue(0)).toBeCloseTo(-1, 2);

    const gauge = higherTfToGaugeValue(
      false,
      { '5m': 0.1, '15m': 0.2, '1h': 0.42 },
      '15m',
    );
    expect(gauge).toBeGreaterThan(0.3);
  });
});