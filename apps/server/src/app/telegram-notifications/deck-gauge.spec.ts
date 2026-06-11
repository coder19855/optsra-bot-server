import {
  buildDeckGauges,
  computeOptionNeedle,
  computeOptionNeedleFromOverallScore,
  computePaNeedle,
  computeReplayOptionNeedle,
} from './deck-gauge';

describe('deck-gauge', () => {
  it('maps CE action to positive option needle', () => {
    expect(computeOptionNeedle('CE-BUY', 62, 'Bullish')).toBeCloseTo(0.62, 2);
  });

  it('maps PE action to negative option needle', () => {
    expect(computeOptionNeedle('PE-BUY', 55, 'Bearish')).toBeCloseTo(-0.55, 2);
  });

  it('clamps price action primary score to -1..1', () => {
    expect(computePaNeedle(0.41)).toBeCloseTo(0.41, 2);
    expect(computePaNeedle(1.8)).toBe(1);
    expect(computePaNeedle(-2)).toBe(-1);
  });

  it('uses overall option score when trade action is flat', () => {
    const reading = computeOptionNeedleFromOverallScore(
      18,
      'NO-TRADE',
      25,
      'Neutral',
    );
    expect(reading.value).toBeCloseTo(0.18, 2);
    expect(reading.percent).toBe(18);
  });

  it('recovers replay option needle from structural action after veto', () => {
    const needle = computeReplayOptionNeedle(
      {
        signal: {
          action: 'NO-TRADE',
          confidence: 0,
          structuralAction: 'CE-BUY',
        },
        timeframeScores: { '5m': 0, '15m': 0.35, '1h': 0.1 },
        mtfScore: 0.22,
      },
      '15m',
    );
    expect(needle).toBeGreaterThan(0);
  });

  it('flags conflict when needles disagree', () => {
    const gauges = buildDeckGauges({
      action: 'CE-BUY',
      optionConviction: 60,
      optionBias: 'Bullish',
      priceConviction: 40,
      primaryScore: -0.5,
    });
    expect(gauges.conflict).toBe(true);
    expect(gauges.aligned).toBe(false);
  });
});