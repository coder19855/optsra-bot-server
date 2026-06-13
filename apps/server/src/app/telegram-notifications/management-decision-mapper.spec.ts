import {
  formatTradeDecisionError,
  normalizePriceActionSignal,
  toManagementDecisionPayload,
} from './management-decision-mapper';

describe('management-decision-mapper', () => {
  it('normalizes chart-vetoed directional PA to NO-TRADE', () => {
    expect(
      normalizePriceActionSignal({ action: 'CE-BUY', confidence: 0 }),
    ).toMatchObject({
      action: 'NO-TRADE',
      confidence: 0,
    });
  });

  it('keeps directional PA when confidence is non-zero', () => {
    expect(
      normalizePriceActionSignal({ action: 'PE-BUY', confidence: 72 }),
    ).toMatchObject({
      action: 'PE-BUY',
      confidence: 72,
    });
  });

  it('builds management payload from trade-decision fields', () => {
    const payload = toManagementDecisionPayload({
      action: 'CE-BUY',
      conviction: 68,
      overallSignal: { action: 'CE-BUY', confidence: 0, vetoReason: 'decay' },
    });
    expect(payload.action).toBe('CE-BUY');
    expect(payload.conviction).toBe(68);
    expect(payload.priceAction.action).toBe('NO-TRADE');
  });

  it('formats upstream trade-decision errors with detail', () => {
    const message = formatTradeDecisionError(
      502,
      JSON.stringify({
        priceStatus: 400,
        optionStatus: 500,
        priceError: 'history failed',
        optionError: 'chain failed',
      }),
    );
    expect(message).toContain('price=400');
    expect(message).toContain('option=500');
    expect(message).toContain('history failed');
    expect(message).toContain('chain failed');
  });
});