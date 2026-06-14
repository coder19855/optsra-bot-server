import { toErrorMessage } from './error-message';

describe('toErrorMessage', () => {
  it('reads message from Fyers-style error objects', () => {
    expect(
      toErrorMessage({ s: 'error', code: -16, message: 'Could not authenticate' }),
    ).toBe('-16: Could not authenticate');
  });

  it('avoids [object Object] for plain objects', () => {
    const text = toErrorMessage({ s: 'error', code: 500, message: 'Rate limited' });
    expect(text).not.toContain('[object Object]');
    expect(text).toContain('Rate limited');
  });

  it('uses Error.message when present', () => {
    expect(toErrorMessage(new Error('Fyers session expired'))).toBe(
      'Fyers session expired',
    );
  });
});