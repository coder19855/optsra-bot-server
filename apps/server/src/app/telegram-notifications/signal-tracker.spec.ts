import { TELEGRAM_NOTIFICATION_DEFAULTS } from '../constants/telegram-notifications';
import { SignalSnapshot } from '../types/telegram-notifications';
import { TradingStyle } from '../types/trading-style';
import {
  buildEngagementContext,
  buildExitTelemetry,
} from './signal-exit-policy';
import {
  buildSignalFingerprint,
  computeDirectionalStreak,
  computeNoTradeStreak,
  detectSignalChange,
  getIstSessionClock,
  hydrateSignalSnapshot,
  isIndianMarketOpen,
  isIndianWeekday,
  isWithinPostSessionCoachWindow,
  isWithinPreSessionLearningWindow,
  snapshotKey,
} from './signal-tracker';

const BASE_TIME = Date.UTC(2026, 5, 11, 4, 0, 0); // 09:30 IST, Wednesday

const defaultDetectOptions = {
  minConvictionForInitial:
    TELEGRAM_NOTIFICATION_DEFAULTS.MIN_CONVICTION_FOR_INITIAL_ALERT,
  minDirectionalStreakForEntry:
    TELEGRAM_NOTIFICATION_DEFAULTS.SIGNAL_ENTRY_CONFIRM_POLLS,
  minNoTradeStreakForExit:
    TELEGRAM_NOTIFICATION_DEFAULTS.SIGNAL_EXIT_CONFIRM_POLLS,
};

function snap(
  overrides: Partial<SignalSnapshot> & Pick<SignalSnapshot, 'action'>,
): SignalSnapshot {
  const action = overrides.action;
  const paAction = overrides.paAction ?? (action === 'NO-TRADE' ? 'NO-TRADE' : action);
  const bias = overrides.bias ?? 'Neutral';
  const shouldConsiderTrade = overrides.shouldConsiderTrade ?? false;
  const topStrategy = overrides.topStrategy ?? null;

  return {
    key: overrides.key ?? snapshotKey('NSE:NIFTY50-INDEX', TradingStyle.Intraday),
    symbol: overrides.symbol ?? 'NSE:NIFTY50-INDEX',
    tradingStyle: overrides.tradingStyle ?? TradingStyle.Intraday,
    action,
    paAction,
    bias,
    conviction: overrides.conviction ?? 0,
    shouldConsiderTrade,
    topStrategy,
    lastPrice: overrides.lastPrice ?? 25000,
    recommendation: overrides.recommendation ?? '',
    humanSummary: overrides.humanSummary ?? '',
    fingerprint:
      overrides.fingerprint ??
      buildSignalFingerprint({
        action,
        paAction,
        bias,
        shouldConsiderTrade,
        topStrategy,
      }),
    updatedAt: overrides.updatedAt ?? new Date(BASE_TIME),
    lastNotifiedAt: overrides.lastNotifiedAt,
    lastNotifiedFingerprint: overrides.lastNotifiedFingerprint,
    directionalStreak: overrides.directionalStreak,
    noTradeStreak: overrides.noTradeStreak,
    awaitingEntryConfirmation: overrides.awaitingEntryConfirmation,
    awaitingExitConfirmation: overrides.awaitingExitConfirmation,
    engagedDirection: overrides.engagedDirection,
    awaitingHardExitConfirmation: overrides.awaitingHardExitConfirmation,
    awaitingOppositeExitConfirmation: overrides.awaitingOppositeExitConfirmation,
    lastEdgeFadeFingerprint: overrides.lastEdgeFadeFingerprint,
  };
}

describe('computeDirectionalStreak', () => {
  it('returns 0 for non-directional actions', () => {
    expect(computeDirectionalStreak(null, 'NO-TRADE')).toBe(0);
    expect(computeDirectionalStreak(null, 'NEUTRAL')).toBe(0);
  });

  it('starts at 1 on a new directional read', () => {
    expect(computeDirectionalStreak(null, 'PE-BUY')).toBe(1);
    expect(
      computeDirectionalStreak(snap({ action: 'NO-TRADE' }), 'PE-BUY'),
    ).toBe(1);
  });

  it('increments when the same direction holds', () => {
    const previous = snap({
      action: 'PE-BUY',
      directionalStreak: 1,
    });
    expect(computeDirectionalStreak(previous, 'PE-BUY')).toBe(2);
    expect(
      computeDirectionalStreak(
        { ...previous, directionalStreak: 4 },
        'PE-BUY',
      ),
    ).toBe(5);
  });

  it('resets to 1 when direction flips', () => {
    const previous = snap({ action: 'PE-BUY', directionalStreak: 3 });
    expect(computeDirectionalStreak(previous, 'CE-BUY')).toBe(1);
  });
});

describe('computeNoTradeStreak', () => {
  it('returns 0 when action is not NO-TRADE', () => {
    expect(computeNoTradeStreak(snap({ action: 'PE-BUY' }), 'PE-BUY')).toBe(0);
  });

  it('increments on consecutive NO-TRADE polls', () => {
    const previous = snap({ action: 'NO-TRADE', noTradeStreak: 1 });
    expect(computeNoTradeStreak(previous, 'NO-TRADE')).toBe(2);
  });
});

describe('buildSignalFingerprint', () => {
  it('encodes action, PA, bias, trade-ready, and strategy', () => {
    expect(
      buildSignalFingerprint({
        action: 'PE-BUY',
        paAction: 'PE-BUY',
        bias: 'Strong Bearish',
        shouldConsiderTrade: true,
        topStrategy: 'Long Put',
      }),
    ).toBe('PE-BUY|PE-BUY|Strong Bearish|1|Long Put');
  });
});

describe('detectSignalChange', () => {
  describe('baseline / no-change', () => {
    it('never notifies without a previous snapshot', () => {
      const current = snap({
        action: 'PE-BUY',
        bias: 'Strong Bearish',
        conviction: 62,
        shouldConsiderTrade: true,
        directionalStreak: 2,
      });

      const result = detectSignalChange(null, current, defaultDetectOptions);

      expect(result.shouldNotify).toBe(false);
      expect(result.kinds).toEqual([]);
    });

    it('does not notify when the fingerprint is unchanged', () => {
      const previous = snap({
        action: 'NO-TRADE',
        bias: 'Moderate Bearish',
        conviction: 20,
      });
      const current = { ...previous, updatedAt: new Date(BASE_TIME + 60_000) };

      const result = detectSignalChange(previous, current, defaultDetectOptions);

      expect(result.shouldNotify).toBe(false);
    });
  });

  describe('entry confirmation (anti-whipsaw)', () => {
    it('suppresses the first poll of NO-TRADE → PE-BUY', () => {
      const previous = snap({
        action: 'NO-TRADE',
        bias: 'Moderate Bearish',
        conviction: 20,
      });
      const current = snap({
        action: 'PE-BUY',
        paAction: 'PE-BUY',
        bias: 'Strong Bearish',
        conviction: 62,
        shouldConsiderTrade: true,
        directionalStreak: 1,
        awaitingEntryConfirmation: true,
      });

      const result = detectSignalChange(previous, current, defaultDetectOptions);

      expect(result.kinds).toContain('ACTION');
      expect(result.shouldNotify).toBe(false);
    });

    it('notifies on the second consecutive PE poll via awaiting confirmation', () => {
      const previous = snap({
        action: 'PE-BUY',
        paAction: 'PE-BUY',
        bias: 'Strong Bearish',
        conviction: 62,
        shouldConsiderTrade: true,
        directionalStreak: 1,
        awaitingEntryConfirmation: true,
      });
      const current = {
        ...previous,
        directionalStreak: 2,
        awaitingEntryConfirmation: true,
      };

      const result = detectSignalChange(previous, current, defaultDetectOptions);

      expect(result.kinds).toEqual(['ACTION']);
      expect(result.shouldNotify).toBe(true);
    });

    it('notifies when PA aligns on the confirming second poll', () => {
      const previous = snap({
        action: 'PE-BUY',
        paAction: 'NO-TRADE',
        bias: 'Strong Bearish',
        conviction: 62,
        shouldConsiderTrade: true,
        directionalStreak: 1,
        awaitingEntryConfirmation: true,
      });
      const current = snap({
        action: 'PE-BUY',
        paAction: 'PE-BUY',
        bias: 'Strong Bearish',
        conviction: 64,
        shouldConsiderTrade: true,
        directionalStreak: 2,
      });

      const result = detectSignalChange(previous, current, defaultDetectOptions);

      expect(result.kinds).toContain('PA_SIGNAL');
      expect(result.shouldNotify).toBe(true);
    });

    it('blocks entry when conviction is below the minimum initial threshold', () => {
      const previous = snap({ action: 'NO-TRADE', conviction: 20 });
      const current = snap({
        action: 'PE-BUY',
        paAction: 'PE-BUY',
        bias: 'Moderate Bearish',
        conviction: 30,
        shouldConsiderTrade: true,
        directionalStreak: 2,
      });

      const result = detectSignalChange(previous, current, defaultDetectOptions);

      expect(result.shouldNotify).toBe(false);
    });

    it('blocks entry when shouldConsiderTrade is false even with high conviction', () => {
      const previous = snap({ action: 'NO-TRADE', conviction: 20 });
      const current = snap({
        action: 'PE-BUY',
        paAction: 'PE-BUY',
        bias: 'Strong Bearish',
        conviction: 62,
        shouldConsiderTrade: false,
        directionalStreak: 2,
      });

      const result = detectSignalChange(previous, current, defaultDetectOptions);

      expect(result.shouldNotify).toBe(false);
    });

    it('requires confirmation before notifying a CE ↔ PE flip', () => {
      const previous = snap({
        action: 'CE-BUY',
        paAction: 'CE-BUY',
        bias: 'Strong Bullish',
        conviction: 65,
        shouldConsiderTrade: true,
        directionalStreak: 4,
      });
      const current = snap({
        action: 'PE-BUY',
        paAction: 'PE-BUY',
        bias: 'Strong Bearish',
        conviction: 62,
        shouldConsiderTrade: true,
        directionalStreak: 1,
        awaitingEntryConfirmation: true,
      });

      const result = detectSignalChange(previous, current, defaultDetectOptions);

      expect(result.kinds).toContain('ACTION');
      expect(result.shouldNotify).toBe(false);
    });
  });

  describe('exit confirmation (anti-whipsaw)', () => {
    it('suppresses the first PE-BUY → NO-TRADE poll', () => {
      const previous = snap({
        action: 'PE-BUY',
        paAction: 'PE-BUY',
        bias: 'Strong Bearish',
        conviction: 62,
        shouldConsiderTrade: true,
        directionalStreak: 2,
      });
      const current = snap({
        action: 'NO-TRADE',
        paAction: 'NO-TRADE',
        bias: 'Moderate Bearish',
        conviction: 21,
        shouldConsiderTrade: false,
        noTradeStreak: 1,
        awaitingExitConfirmation: true,
      });

      const result = detectSignalChange(previous, current, defaultDetectOptions);

      expect(result.kinds).toContain('ACTION');
      expect(result.shouldNotify).toBe(false);
    });

    it('suppresses the second consecutive NO-TRADE poll', () => {
      const previous = snap({
        action: 'NO-TRADE',
        paAction: 'NO-TRADE',
        bias: 'Moderate Bearish',
        conviction: 21,
        shouldConsiderTrade: false,
        noTradeStreak: 1,
        awaitingExitConfirmation: true,
      });
      const current = snap({
        action: 'NO-TRADE',
        paAction: 'NO-TRADE',
        bias: 'Moderate Bearish',
        conviction: 20,
        shouldConsiderTrade: false,
        noTradeStreak: 2,
        awaitingExitConfirmation: true,
      });

      const result = detectSignalChange(previous, current, defaultDetectOptions);

      expect(result.shouldNotify).toBe(false);
    });

    it('notifies exit on the third consecutive NO-TRADE poll', () => {
      const previous = snap({
        action: 'NO-TRADE',
        paAction: 'NO-TRADE',
        bias: 'Moderate Bearish',
        conviction: 20,
        shouldConsiderTrade: false,
        noTradeStreak: 2,
        awaitingExitConfirmation: true,
      });
      const current = snap({
        action: 'NO-TRADE',
        paAction: 'NO-TRADE',
        bias: 'Moderate Bearish',
        conviction: 19,
        shouldConsiderTrade: false,
        noTradeStreak: 3,
        awaitingExitConfirmation: true,
      });

      const result = detectSignalChange(previous, current, defaultDetectOptions);

      expect(result.kinds).toContain('ACTION');
      expect(result.shouldNotify).toBe(true);
    });

    it('notifies exit on poll 3 via unchanged fingerprint confirmation', () => {
      const previous = snap({
        action: 'NO-TRADE',
        paAction: 'NO-TRADE',
        bias: 'Moderate Bearish',
        conviction: 21,
        shouldConsiderTrade: false,
        noTradeStreak: 2,
        awaitingExitConfirmation: true,
      });
      const current = {
        ...previous,
        noTradeStreak: 3,
        awaitingExitConfirmation: true,
        updatedAt: new Date(BASE_TIME + 120_000),
      };

      const result = detectSignalChange(previous, current, defaultDetectOptions);

      expect(result.shouldNotify).toBe(true);
    });

    it('cancels exit confirmation when direction returns before poll 3', () => {
      const previous = snap({
        action: 'NO-TRADE',
        paAction: 'NO-TRADE',
        bias: 'Moderate Bearish',
        conviction: 21,
        shouldConsiderTrade: false,
        noTradeStreak: 2,
        awaitingExitConfirmation: true,
      });
      const current = snap({
        action: 'PE-BUY',
        paAction: 'PE-BUY',
        bias: 'Strong Bearish',
        conviction: 62,
        shouldConsiderTrade: true,
        directionalStreak: 1,
        awaitingEntryConfirmation: true,
      });

      const result = detectSignalChange(previous, current, defaultDetectOptions);

      expect(result.kinds).toContain('ACTION');
      expect(result.shouldNotify).toBe(false);
    });
  });

  describe('full whipsaw scenario (62% PE then 21% NO-TRADE in 1 min)', () => {
    it('confirms entry on poll 2 and suppresses the 1-minute exit flip', () => {
      let previous = snap({
        action: 'NO-TRADE',
        bias: 'Moderate Bearish',
        conviction: 20,
        shouldConsiderTrade: false,
      });

      // Poll 1: spike to PE-BUY — saved but not alerted
      let current = snap({
        action: 'PE-BUY',
        paAction: 'PE-BUY',
        bias: 'Strong Bearish',
        conviction: 62,
        shouldConsiderTrade: true,
        directionalStreak: computeDirectionalStreak(previous, 'PE-BUY'),
        awaitingEntryConfirmation: true,
      });
      let change = detectSignalChange(previous, current, defaultDetectOptions);
      expect(change.shouldNotify).toBe(false);

      // Poll 2: still PE-BUY — entry alert fires
      previous = { ...current };
      current = {
        ...current,
        directionalStreak: computeDirectionalStreak(previous, 'PE-BUY'),
        awaitingEntryConfirmation: true,
      };
      change = detectSignalChange(previous, current, defaultDetectOptions);
      expect(change.shouldNotify).toBe(true);

      const entryNotifiedAt = new Date(BASE_TIME + 60_000);
      previous = {
        ...current,
        lastNotifiedAt: entryNotifiedAt,
        awaitingEntryConfirmation: false,
      };

      // Poll 3: one minute later, collapses to NO-TRADE — exit poll 1, suppressed
      current = snap({
        action: 'NO-TRADE',
        paAction: 'PE-BUY',
        bias: 'Moderate Bearish',
        conviction: 21,
        shouldConsiderTrade: false,
        noTradeStreak: computeNoTradeStreak(previous, 'NO-TRADE'),
        awaitingExitConfirmation: true,
      });
      change = detectSignalChange(previous, current, defaultDetectOptions);
      expect(change.shouldNotify).toBe(false);

      // Poll 4–5: still NO-TRADE — need 3 consecutive before exit alert
      previous = { ...current };
      current = {
        ...current,
        noTradeStreak: computeNoTradeStreak(previous, 'NO-TRADE'),
        awaitingExitConfirmation: true,
      };
      change = detectSignalChange(previous, current, defaultDetectOptions);
      expect(change.shouldNotify).toBe(false);

      previous = { ...current };
      current = {
        ...current,
        noTradeStreak: computeNoTradeStreak(previous, 'NO-TRADE'),
        awaitingExitConfirmation: true,
      };
      change = detectSignalChange(previous, current, defaultDetectOptions);
      expect(change.shouldNotify).toBe(true);
    });
  });

  describe('hydrateSignalSnapshot', () => {
    it('parses ISO lastNotifiedAt strings for snapshot hydration', () => {
      const hydrated = hydrateSignalSnapshot(
        snap({
          action: 'PE-BUY',
          lastNotifiedAt: '2026-06-11T04:01:00.000Z' as unknown as Date,
        }),
      );
      expect(hydrated.lastNotifiedAt).toBeInstanceOf(Date);
      expect(hydrated.lastNotifiedAt?.getTime()).toBe(
        new Date('2026-06-11T04:01:00.000Z').getTime(),
      );
    });
  });

  describe('engaged exit policy', () => {
    const engagement = buildEngagementContext({
      enterThreshold: 60,
      heldDirection: 'PE-BUY',
    });

    it('sends EDGE_FADE caution instead of flat exit on first NO-TRADE poll', () => {
      const previous = snap({
        action: 'PE-BUY',
        conviction: 62,
        shouldConsiderTrade: true,
        engagedDirection: 'PE-BUY',
      });
      const current = snap({
        action: 'NO-TRADE',
        conviction: 21,
        shouldConsiderTrade: false,
        noTradeStreak: 1,
      });
      const telemetry = buildExitTelemetry(
        {
          lastPrice: 25000,
          priceAction: {
            action: 'NO-TRADE',
            confidence: 0,
            structuralAction: 'PE-BUY',
            confidenceBeforeDecay: 62,
          },
          momentumDecayPercent: 30,
        } as Parameters<typeof buildExitTelemetry>[0],
        'PE-BUY',
      );

      const result = detectSignalChange(previous, current, {
        ...defaultDetectOptions,
        engagement,
        telemetry,
      });

      expect(result.kinds).toEqual(['EDGE_FADE']);
      expect(result.shouldNotify).toBe(true);
      expect(result.alertTone).toBe('caution');
    });

    it('suppresses same-direction entry alerts while holding an open leg', () => {
      const previous = snap({
        action: 'CE-BUY',
        paAction: 'NO-TRADE',
        bias: 'Moderate Bullish',
        conviction: 72,
        shouldConsiderTrade: true,
        directionalStreak: 2,
        engagedDirection: 'CE-BUY',
      });
      const current = snap({
        action: 'CE-BUY',
        paAction: 'CE-BUY',
        bias: 'Strong Bullish',
        conviction: 88,
        shouldConsiderTrade: true,
        directionalStreak: 3,
      });
      const telemetry = buildExitTelemetry(
        {
          lastPrice: 25100,
          priceAction: { action: 'CE-BUY', confidence: 88 },
        } as Parameters<typeof buildExitTelemetry>[0],
        'CE-BUY',
      );

      const result = detectSignalChange(previous, current, {
        ...defaultDetectOptions,
        engagement: buildEngagementContext({
          enterThreshold: 60,
          heldDirection: 'CE-BUY',
        }),
        telemetry,
      });

      expect(result.kinds).toEqual([]);
      expect(result.shouldNotify).toBe(false);
    });

    it('skips flat 3-poll exit while engaged', () => {
      const previous = snap({
        action: 'NO-TRADE',
        conviction: 20,
        noTradeStreak: 2,
        awaitingExitConfirmation: true,
        engagedDirection: 'PE-BUY',
      });
      const current = snap({
        action: 'NO-TRADE',
        conviction: 19,
        noTradeStreak: 3,
      });
      const telemetry = buildExitTelemetry(
        {
          lastPrice: 25000,
          priceAction: { action: 'NO-TRADE', confidence: 0 },
        } as Parameters<typeof buildExitTelemetry>[0],
        'PE-BUY',
      );

      const result = detectSignalChange(previous, current, {
        ...defaultDetectOptions,
        engagement,
        telemetry,
      });

      expect(result.shouldNotify).toBe(false);
    });
  });

  describe('other notify paths', () => {
    it('notifies on transition to NEUTRAL', () => {
      const previous = snap({
        action: 'NO-TRADE',
        bias: 'Neutral',
        conviction: 25,
      });
      const current = snap({
        action: 'NEUTRAL',
        bias: 'Neutral',
        conviction: 40,
        shouldConsiderTrade: true,
        topStrategy: 'Iron Condor',
      });

      const result = detectSignalChange(previous, current, defaultDetectOptions);

      expect(result.kinds).toContain('ACTION');
      expect(result.shouldNotify).toBe(true);
    });

    it('notifies when NO-TRADE becomes trade-ready without a directional action', () => {
      const previous = snap({
        action: 'NO-TRADE',
        bias: 'Neutral',
        conviction: 38,
        shouldConsiderTrade: false,
      });
      const current = snap({
        action: 'NO-TRADE',
        bias: 'Neutral',
        conviction: 42,
        shouldConsiderTrade: true,
        topStrategy: 'Iron Condor',
      });

      const result = detectSignalChange(previous, current, defaultDetectOptions);

      expect(result.kinds).toContain('TRADE_READY');
      expect(result.shouldNotify).toBe(true);
    });

    it('waits for entry streak before PA signal catch-up notifies', () => {
      const previous = snap({
        action: 'PE-BUY',
        paAction: 'NO-TRADE',
        bias: 'Moderate Bearish',
        conviction: 55,
        shouldConsiderTrade: true,
        directionalStreak: 1,
      });
      const current = snap({
        action: 'PE-BUY',
        paAction: 'PE-BUY',
        bias: 'Strong Bearish',
        conviction: 62,
        shouldConsiderTrade: true,
        directionalStreak: 2,
      });

      const result = detectSignalChange(previous, current, defaultDetectOptions);

      expect(result.kinds).toContain('PA_SIGNAL');
      expect(result.shouldNotify).toBe(true);
    });

    it('suppresses PA signal notify when entry streak is not confirmed', () => {
      const previous = snap({
        action: 'PE-BUY',
        paAction: 'NO-TRADE',
        bias: 'Moderate Bearish',
        conviction: 55,
        shouldConsiderTrade: true,
        directionalStreak: 1,
      });
      const current = snap({
        action: 'PE-BUY',
        paAction: 'PE-BUY',
        bias: 'Strong Bearish',
        conviction: 62,
        shouldConsiderTrade: true,
        directionalStreak: 1,
      });

      const result = detectSignalChange(previous, current, defaultDetectOptions);

      expect(result.kinds).toContain('PA_SIGNAL');
      expect(result.shouldNotify).toBe(false);
    });

    it('does not notify on PA change to NO-TRADE alone', () => {
      const previous = snap({
        action: 'PE-BUY',
        paAction: 'PE-BUY',
        bias: 'Strong Bearish',
        conviction: 62,
        shouldConsiderTrade: true,
      });
      const current = snap({
        action: 'PE-BUY',
        paAction: 'NO-TRADE',
        bias: 'Strong Bearish',
        conviction: 62,
        shouldConsiderTrade: true,
      });

      const result = detectSignalChange(previous, current, defaultDetectOptions);

      expect(result.kinds).not.toContain('PA_SIGNAL');
      expect(result.shouldNotify).toBe(false);
    });
  });
});

describe('IST session windows', () => {
  // 2026-06-11 04:00:00Z = 09:30 IST (Thursday)
  const weekdayMorningMarket = Date.UTC(2026, 5, 11, 4, 0, 0);
  // 2026-06-11 03:55:00Z = 09:25 IST (after pre-session window)
  const weekdayAfterPreSession = Date.UTC(2026, 5, 11, 3, 55, 0);
  // 2026-06-11 03:30:00Z = 09:00 IST (pre-session)
  const weekdayPreSession = Date.UTC(2026, 5, 11, 3, 30, 0);
  // 2026-06-11 10:30:00Z = 16:00 IST (post-session coach window)
  const weekdayPostSession = Date.UTC(2026, 5, 11, 10, 30, 0);
  // 2026-06-13 = Saturday
  const saturday = Date.UTC(2026, 5, 13, 4, 0, 0);

  it('reads IST clock for a weekday morning', () => {
    const clock = getIstSessionClock(weekdayMorningMarket);
    expect(clock.weekday).toBe('Thu');
    expect(clock.hour).toBe(9);
    expect(clock.minute).toBe(30);
  });

  it('detects Indian weekdays', () => {
    expect(isIndianWeekday(weekdayMorningMarket)).toBe(true);
    expect(isIndianWeekday(saturday)).toBe(false);
  });

  it('detects market open on weekday session hours', () => {
    expect(isIndianMarketOpen(weekdayAfterPreSession)).toBe(true);
    expect(isIndianMarketOpen(weekdayMorningMarket)).toBe(true);
    expect(isIndianMarketOpen(saturday)).toBe(false);
  });

  it('detects pre-session learning window (09:00–09:20 IST)', () => {
    expect(isWithinPreSessionLearningWindow(weekdayPreSession)).toBe(true);
    expect(isWithinPreSessionLearningWindow(weekdayAfterPreSession)).toBe(
      false,
    );
    expect(isWithinPreSessionLearningWindow(saturday)).toBe(false);
  });

  it('detects post-session coach window (after 15:30 IST)', () => {
    expect(isWithinPostSessionCoachWindow(weekdayPostSession)).toBe(true);
    expect(isWithinPostSessionCoachWindow(weekdayMorningMarket)).toBe(false);
    expect(isWithinPostSessionCoachWindow(saturday)).toBe(false);
  });
});