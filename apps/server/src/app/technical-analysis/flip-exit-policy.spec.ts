import { TELEGRAM_NOTIFICATION_DEFAULTS } from '../constants/telegram-notifications';
import {
  buildFlipExitSignals,
  computeOppositeExitStreak,
  findFirstConfirmedFlipExit,
} from './flip-exit-policy';

describe('flip-exit-policy', () => {
  const enterThreshold = 60;

  it('requires two consecutive opposite polls before flip exit', () => {
    const reads = [
      { asOfMs: 5 * 60_000, action: 'PE-BUY', conviction: 65 },
      { asOfMs: 10 * 60_000, action: 'NO-TRADE', conviction: 20 },
      { asOfMs: 15 * 60_000, action: 'PE-BUY', conviction: 68 },
      { asOfMs: 20 * 60_000, action: 'PE-BUY', conviction: 70 },
    ];

    expect(
      findFirstConfirmedFlipExit(0, 'CE-BUY', 30 * 60_000, reads, enterThreshold, 2),
    ).toMatchObject({
      tsMs: 20 * 60_000,
      oppositeAction: 'PE-BUY',
    });
  });

  it('resets opposite streak when direction is not sustained', () => {
    const reads = [
      { asOfMs: 5 * 60_000, action: 'PE-BUY', conviction: 65 },
      { asOfMs: 10 * 60_000, action: 'CE-BUY', conviction: 55 },
      { asOfMs: 15 * 60_000, action: 'PE-BUY', conviction: 70 },
      { asOfMs: 20 * 60_000, action: 'PE-BUY', conviction: 72 },
    ];

    expect(
      findFirstConfirmedFlipExit(0, 'CE-BUY', 30 * 60_000, reads, enterThreshold, 2),
    ).toMatchObject({ tsMs: 20 * 60_000 });
  });

  it('buildFlipExitSignals returns empty until confirmation', () => {
    const reads = [{ asOfMs: 5 * 60_000, action: 'PE-BUY', conviction: 70 }];
    expect(
      buildFlipExitSignals(0, 'CE-BUY', 600, reads, enterThreshold),
    ).toEqual([]);
  });

  it('computeOppositeExitStreak matches live engaged exit cadence', () => {
    const first = computeOppositeExitStreak('CE-BUY', 'PE-BUY', 70, enterThreshold, 0);
    expect(first).toEqual({
      streak: 1,
      confirmed: false,
      awaitingConfirmation: true,
    });

    const second = computeOppositeExitStreak(
      'CE-BUY',
      'PE-BUY',
      72,
      enterThreshold,
      first.streak,
    );
    expect(second.confirmed).toBe(
      TELEGRAM_NOTIFICATION_DEFAULTS.SIGNAL_OPPOSITE_CONFIRM_POLLS <= 2,
    );
    expect(second.streak).toBe(2);
  });
});