import { buildDeckVetoBreakup } from './deck-veto-breakup';

describe('deck-veto-breakup', () => {
  it('marks hard decay as block under strict mode', () => {
    const items = buildDeckVetoBreakup({
      vetoMode: 'strict',
      action: 'NO-TRADE',
      conviction: 16,
      priceConviction: 6,
      priceConvictionBeforeDecay: 22,
      optionConviction: 20,
      enterThreshold: 60,
      conflictLevel: 'LOW',
      alignment: 1,
      paSignal: {
        action: 'NO-TRADE',
        confidence: 0,
        structuralAction: 'CE-BUY',
        vetoReason: 'Hard decay veto: 42% decay',
      },
      momentumDecay: {
        decayPercent: 0.42,
        reasons: ['Near resistance with fading 15m momentum'],
      },
      vetoedByDecay: true,
      minConfidenceAfterDecay: 35,
    });

    const decay = items.find((item) => item.id === 'decay');
    expect(decay?.state).toBe('block');
    expect(decay?.meter).toBe(42);
    expect(items.some((item) => item.id === 'chart' && item.state === 'block')).toBe(
      true,
    );
  });

  it('skips soft decay gates in relaxed mode', () => {
    const items = buildDeckVetoBreakup({
      vetoMode: 'relaxed',
      action: 'NO-TRADE',
      conviction: 16,
      priceConviction: 6,
      optionConviction: 20,
      enterThreshold: 60,
      paSignal: {
        action: 'NO-TRADE',
        confidence: 0,
        vetoReason: 'Opposing 15m structure with multi-factor decay (40%)',
      },
      momentumDecay: {
        decayPercent: 0.28,
        reasons: ['Opposing FVG cluster on 15m'],
      },
    });

    expect(items.find((item) => item.id === 'decay')?.state).toBe('skipped');
    expect(items.find((item) => item.id === 'mode')?.detail).toContain('Relaxed');
  });

  it('labels enter threshold as PA-only when flow mode is pa-only', () => {
    const items = buildDeckVetoBreakup({
      vetoMode: 'relaxed',
      flowMode: 'pa-only',
      action: 'NO-TRADE',
      conviction: 44,
      priceConviction: 26,
      optionConviction: 27,
      enterThreshold: 60,
      paSignal: { action: 'NO-TRADE', confidence: 26 },
    });

    const threshold = items.find((item) => item.id === 'enter-threshold');
    expect(threshold?.detail).toContain('PA-only flow');
    expect(threshold?.detail).toContain('option ignored');
    expect(threshold?.detail).not.toContain('option 27% · PA');
  });
});