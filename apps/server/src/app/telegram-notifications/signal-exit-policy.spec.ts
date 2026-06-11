import { TELEGRAM_NOTIFICATION_DEFAULTS } from '../constants/telegram-notifications';
import { SignalSnapshot } from '../types/telegram-notifications';
import { TradingStyle } from '../types/trading-style';
import { buildSignalFingerprint } from './signal-tracker';
import { ResponseStatus } from '../types/common';
import {
  buildEngagementContext,
  buildExitTelemetry,
  evaluateEngagedExitDecision,
  isIndexStopBreached,
  resolveEngagedHeldDirection,
  resolveExitConvictionFloor,
  resolveHeldDirectionFromOpenPositions,
} from './signal-exit-policy';

function snap(
  overrides: Partial<SignalSnapshot> & Pick<SignalSnapshot, 'action'>,
): SignalSnapshot {
  const action = overrides.action;
  const paAction =
    overrides.paAction ?? (action === 'NO-TRADE' ? 'NO-TRADE' : action);
  const bias = overrides.bias ?? 'Neutral';
  const shouldConsiderTrade = overrides.shouldConsiderTrade ?? false;
  const topStrategy = overrides.topStrategy ?? null;

  return {
    key: 'NSE:NIFTY50-INDEX:INTRADAY',
    symbol: 'NSE:NIFTY50-INDEX',
    tradingStyle: TradingStyle.Intraday,
    action,
    paAction,
    bias,
    conviction: overrides.conviction ?? 50,
    shouldConsiderTrade,
    topStrategy,
    lastPrice: overrides.lastPrice ?? 25000,
    recommendation: '',
    humanSummary: '',
    fingerprint:
      overrides.fingerprint ??
      buildSignalFingerprint({
        action,
        paAction,
        bias,
        shouldConsiderTrade,
        topStrategy,
      }),
    updatedAt: new Date(),
    directionalStreak: overrides.directionalStreak,
    noTradeStreak: overrides.noTradeStreak,
    awaitingHardExitConfirmation: overrides.awaitingHardExitConfirmation,
    awaitingOppositeExitConfirmation: overrides.awaitingOppositeExitConfirmation,
    lastEdgeFadeFingerprint: overrides.lastEdgeFadeFingerprint,
    engagedDirection: overrides.engagedDirection,
  };
}

describe('resolveExitConvictionFloor', () => {
  it('uses ratio of enter threshold with a minimum floor', () => {
    expect(resolveExitConvictionFloor(60)).toBe(42);
    expect(resolveExitConvictionFloor(40)).toBe(
      TELEGRAM_NOTIFICATION_DEFAULTS.SIGNAL_EXIT_CONVICTION_FLOOR_MIN,
    );
  });
});

describe('resolveHeldDirectionFromOpenPositions', () => {
  it('returns direction for a single open leg', () => {
    expect(resolveHeldDirectionFromOpenPositions(['PE-BUY'])).toBe('PE-BUY');
  });

  it('returns null when no open leg exists', () => {
    expect(resolveHeldDirectionFromOpenPositions([])).toBeNull();
  });

  it('returns null when CE and PE are both open', () => {
    expect(
      resolveHeldDirectionFromOpenPositions(['CE-BUY', 'PE-BUY']),
    ).toBeNull();
  });
});

describe('resolveEngagedHeldDirection', () => {
  it('uses only live Fyers positions, not entry intent', async () => {
    const fastify = {
      fyers: {
        get_positions: jest.fn().mockResolvedValue({
          s: ResponseStatus.ok,
          netPositions: [
            {
              symbol: 'NSE:NIFTY25JUN25100PE',
              netQty: 75,
              buyAvg: 180,
            },
          ],
        }),
      },
    } as Parameters<typeof resolveEngagedHeldDirection>[0];

    await expect(
      resolveEngagedHeldDirection(fastify, {
        indexSymbol: 'NSE:NIFTY50-INDEX',
      }),
    ).resolves.toBe('PE-BUY');
  });

  it('returns null when Fyers reports no open legs', async () => {
    const fastify = {
      fyers: {
        get_positions: jest.fn().mockResolvedValue({
          s: ResponseStatus.ok,
          netPositions: [],
        }),
      },
    } as Parameters<typeof resolveEngagedHeldDirection>[0];

    await expect(
      resolveEngagedHeldDirection(fastify, {
        indexSymbol: 'NSE:NIFTY50-INDEX',
      }),
    ).resolves.toBeNull();
  });
});

describe('isIndexStopBreached', () => {
  it('detects CE stop when spot falls through stopLoss', () => {
    expect(
      isIndexStopBreached('CE-BUY', 24900, {
        stopLoss: 24950,
        risk: 50,
        takeProfits: [],
      }),
    ).toBe(true);
  });

  it('detects PE stop when spot rises through stopLoss', () => {
    expect(
      isIndexStopBreached('PE-BUY', 25100, {
        stopLoss: 25050,
        risk: 50,
        takeProfits: [],
      }),
    ).toBe(true);
  });
});

describe('evaluateEngagedExitDecision', () => {
  const engagement = buildEngagementContext({
    enterThreshold: 60,
    heldDirection: 'PE-BUY',
  });

  it('fires an immediate hard exit on index stop breach', () => {
    const previous = snap({ action: 'PE-BUY', engagedDirection: 'PE-BUY' });
    const current = snap({
      action: 'NO-TRADE',
      conviction: 20,
      lastPrice: 25120,
      noTradeStreak: 1,
    });
    const telemetry = buildExitTelemetry(
      {
        lastPrice: 25120,
        tradeSetup: { stopLoss: 25100, risk: 40, takeProfits: [] },
        priceAction: { action: 'NO-TRADE', confidence: 0 },
        momentumDecayPercent: 35,
      } as Parameters<typeof buildExitTelemetry>[0],
      'PE-BUY',
    );

    const decision = evaluateEngagedExitDecision({
      previous,
      current,
      engagement,
      telemetry,
      minExitPolls: 3,
      minOppositePolls: 2,
    });

    expect(decision?.kinds).toEqual(['HARD_EXIT']);
    expect(decision?.notify).toBe(true);
    expect(decision?.alertTone).toBe('hard_exit');
  });

  it('sends a caution EDGE_FADE on the first PE → NO-TRADE poll', () => {
    const previous = snap({
      action: 'PE-BUY',
      conviction: 62,
      engagedDirection: 'PE-BUY',
    });
    const current = snap({
      action: 'NO-TRADE',
      conviction: 21,
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

    const decision = evaluateEngagedExitDecision({
      previous,
      current,
      engagement,
      telemetry,
      minExitPolls: 3,
      minOppositePolls: 2,
    });

    expect(decision?.kinds).toEqual(['EDGE_FADE']);
    expect(decision?.notify).toBe(true);
    expect(decision?.alertTone).toBe('caution');
    expect(decision?.awaitingHardExitConfirmation).toBe(true);
  });

  it('suppresses duplicate EDGE_FADE cautions for the same fingerprint', () => {
    const fingerprint = buildSignalFingerprint({
      action: 'NO-TRADE',
      paAction: 'NO-TRADE',
      bias: 'Moderate Bearish',
      shouldConsiderTrade: false,
      topStrategy: null,
    });
    const previous = snap({
      action: 'NO-TRADE',
      conviction: 21,
      noTradeStreak: 1,
      engagedDirection: 'PE-BUY',
      awaitingHardExitConfirmation: true,
      lastEdgeFadeFingerprint: `PE-BUY|fade|${fingerprint}`,
      fingerprint,
    });
    const current = snap({
      action: 'NO-TRADE',
      conviction: 20,
      noTradeStreak: 2,
      fingerprint,
    });
    const telemetry = buildExitTelemetry(
      {
        lastPrice: 25000,
        priceAction: { action: 'NO-TRADE', confidence: 0 },
      } as Parameters<typeof buildExitTelemetry>[0],
      'PE-BUY',
    );

    const decision = evaluateEngagedExitDecision({
      previous,
      current,
      engagement,
      telemetry,
      minExitPolls: 3,
      minOppositePolls: 2,
    });

    expect(decision?.notify).toBe(false);
  });

  it('confirms opposite-direction hard exit after two polls', () => {
    const previous = snap({
      action: 'CE-BUY',
      directionalStreak: 1,
      engagedDirection: 'PE-BUY',
      awaitingOppositeExitConfirmation: true,
    });
    const current = snap({
      action: 'CE-BUY',
      directionalStreak: 2,
      conviction: 65,
      shouldConsiderTrade: true,
    });
    const telemetry = buildExitTelemetry(
      {
        lastPrice: 25000,
        priceAction: { action: 'CE-BUY', confidence: 60 },
      } as Parameters<typeof buildExitTelemetry>[0],
      'PE-BUY',
    );

    const decision = evaluateEngagedExitDecision({
      previous,
      current,
      engagement,
      telemetry,
      minExitPolls: 3,
      minOppositePolls: 2,
    });

    expect(decision?.kinds).toEqual(['HARD_EXIT']);
    expect(decision?.notify).toBe(true);
    expect(decision?.exitReason).toContain('Opposite CE-BUY');
  });

  it('fires hard exit after 3 NO-TRADE polls with low conviction and hard decay', () => {
    const previous = snap({
      action: 'NO-TRADE',
      conviction: 30,
      noTradeStreak: 2,
      engagedDirection: 'PE-BUY',
      awaitingHardExitConfirmation: true,
    });
    const current = snap({
      action: 'NO-TRADE',
      conviction: 30,
      noTradeStreak: 3,
    });
    const telemetry = buildExitTelemetry(
      {
        lastPrice: 25000,
        priceAction: {
          action: 'NO-TRADE',
          confidence: 0,
          structuralAction: 'PE-BUY',
          vetoReason: 'Momentum decay',
          confidenceBeforeDecay: 55,
        },
        momentumDecayPercent: 35,
      } as Parameters<typeof buildExitTelemetry>[0],
      'PE-BUY',
    );

    const decision = evaluateEngagedExitDecision({
      previous,
      current,
      engagement,
      telemetry,
      minExitPolls: 3,
      minOppositePolls: 2,
    });

    expect(decision?.kinds).toEqual(['HARD_EXIT']);
    expect(decision?.notify).toBe(true);
    expect(decision?.exitReason).toContain('below 42%');
  });
});