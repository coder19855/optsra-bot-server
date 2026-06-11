import { FastifyInstance } from 'fastify';
import { ENTRY_VETO } from '../constants/technical-analysis';
import { TELEGRAM_NOTIFICATION_DEFAULTS } from '../constants/telegram-notifications';
import { TradeSetup } from '../types/technical-analysis';
import { DecisionAction } from '../types/trade-decision';

import {
  SignalAlertTone,
  SignalChangeKind,
  SignalSnapshot,
  TradeDecisionAlertPayload,
} from '../types/telegram-notifications';
import { fetchOpenIndexOptionPositions } from './position-monitor';

export type HeldDirection = 'CE-BUY' | 'PE-BUY';

export interface SignalEngagementContext {
  engaged: boolean;
  heldDirection: HeldDirection | null;
  enterThreshold: number;
  exitConvictionFloor: number;
}

export interface SignalExitTelemetry {
  hardDecayVeto: boolean;
  stopBreached: boolean;
  momentumDecayPercent: number | null;
}

export interface SignalExitDecision {
  notify: boolean;
  kinds: SignalChangeKind[];
  alertTone: SignalAlertTone;
  exitReason: string | null;
  awaitingExitConfirmation: boolean;
  awaitingOppositeExitConfirmation: boolean;
  awaitingHardExitConfirmation: boolean;
  lastEdgeFadeFingerprint: string | null;
}

function isDirectional(action: DecisionAction): action is HeldDirection {
  return action === 'CE-BUY' || action === 'PE-BUY';
}

function isOppositeDirection(
  held: HeldDirection,
  action: DecisionAction,
): boolean {
  return (
    (held === 'PE-BUY' && action === 'CE-BUY') ||
    (held === 'CE-BUY' && action === 'PE-BUY')
  );
}

export function resolveExitConvictionFloor(enterThreshold: number): number {
  const ratio = TELEGRAM_NOTIFICATION_DEFAULTS.SIGNAL_EXIT_CONVICTION_RATIO;
  return Math.max(
    TELEGRAM_NOTIFICATION_DEFAULTS.SIGNAL_EXIT_CONVICTION_FLOOR_MIN,
    Math.floor(enterThreshold * ratio),
  );
}

export function buildEngagementContext(params: {
  enterThreshold: number;
  heldDirection: HeldDirection | null;
}): SignalEngagementContext {
  return {
    engaged: params.heldDirection != null,
    heldDirection: params.heldDirection,
    enterThreshold: params.enterThreshold,
    exitConvictionFloor: resolveExitConvictionFloor(params.enterThreshold),
  };
}

export function isIndexStopBreached(
  direction: HeldDirection,
  spot: number,
  setup: TradeSetup | null | undefined,
): boolean {
  if (!setup?.stopLoss || setup.risk <= 0) return false;
  if (direction === 'CE-BUY') return spot <= setup.stopLoss;
  return spot >= setup.stopLoss;
}

export function buildExitTelemetry(
  payload: TradeDecisionAlertPayload,
  heldDirection: HeldDirection | null,
): SignalExitTelemetry {
  const pa = payload.priceAction;
  const decayPct =
    payload.momentumDecayPercent ??
    (pa.confidence === 0 && pa.confidenceBeforeDecay != null ? 30 : null);

  const hardDecayVeto =
    pa.confidence === 0 &&
    Boolean(
      pa.vetoReason ||
        pa.structuralAction ||
        pa.confidenceBeforeDecay != null ||
        (decayPct != null && decayPct >= ENTRY_VETO.HARD_DECAY_VETO * 100),
    );

  const stopBreached =
    heldDirection != null
      ? isIndexStopBreached(
          heldDirection,
          payload.lastPrice,
          payload.tradeSetup,
        )
      : false;

  return {
    hardDecayVeto,
    stopBreached,
    momentumDecayPercent: decayPct,
  };
}

export function evaluateEngagedExitDecision(params: {
  previous: SignalSnapshot;
  current: SignalSnapshot;
  engagement: SignalEngagementContext;
  telemetry: SignalExitTelemetry;
  minExitPolls: number;
  minOppositePolls: number;
}): SignalExitDecision | null {
  const held = params.engagement.heldDirection;
  if (!params.engagement.engaged || !held) return null;

  const { previous, current, telemetry, minExitPolls, minOppositePolls } =
    params;
  const floor = params.engagement.exitConvictionFloor;
  const exitStreakReady =
    current.action === 'NO-TRADE' &&
    (current.noTradeStreak ?? 0) >= minExitPolls;
  const oppositeStreakReady =
    isDirectional(current.action) &&
    isOppositeDirection(held, current.action) &&
    (current.directionalStreak ?? 0) >= minOppositePolls;

  if (telemetry.stopBreached) {
    return {
      notify: true,
      kinds: ['HARD_EXIT'],
      alertTone: 'hard_exit',
      exitReason: `Index stop breached (spot ${current.lastPrice.toLocaleString('en-IN')})`,
      awaitingExitConfirmation: false,
      awaitingOppositeExitConfirmation: false,
      awaitingHardExitConfirmation: false,
      lastEdgeFadeFingerprint: previous.lastEdgeFadeFingerprint ?? null,
    };
  }

  if (isOppositeDirection(held, current.action)) {
    const continuingOpposite =
      previous.awaitingOppositeExitConfirmation === true;
    const startedOpposite =
      isDirectional(previous.action) &&
      isOppositeDirection(held, previous.action);
    const inOppositePath =
      isOppositeDirection(held, current.action) &&
      (continuingOpposite || !isDirectional(previous.action) || startedOpposite);

    if (inOppositePath) {
      return {
        notify: oppositeStreakReady,
        kinds: ['HARD_EXIT'],
        alertTone: 'hard_exit',
        exitReason: oppositeStreakReady
          ? `Opposite ${current.action} confirmed — exit ${held}`
          : null,
        awaitingExitConfirmation: false,
        awaitingOppositeExitConfirmation: !oppositeStreakReady,
        awaitingHardExitConfirmation: false,
        lastEdgeFadeFingerprint: previous.lastEdgeFadeFingerprint ?? null,
      };
    }
  }

  const exitedHeld =
    isDirectional(previous.action) &&
    (previous.action === held || previous.engagedDirection === held) &&
    current.action === 'NO-TRADE';
  const continuingHardExit =
    previous.action === 'NO-TRADE' &&
    current.action === 'NO-TRADE' &&
    Boolean(previous.awaitingHardExitConfirmation);
  const inHardExitPath = exitedHeld || continuingHardExit;

  if (inHardExitPath) {
    const belowFloor = current.conviction < floor;
    const hardReady =
      exitStreakReady && belowFloor && telemetry.hardDecayVeto;

    if (hardReady) {
      return {
        notify: true,
        kinds: ['HARD_EXIT'],
        alertTone: 'hard_exit',
        exitReason: `Conviction ${current.conviction}% below ${floor}% with chart veto — exit ${held}`,
        awaitingExitConfirmation: false,
        awaitingOppositeExitConfirmation: false,
        awaitingHardExitConfirmation: false,
        lastEdgeFadeFingerprint: previous.lastEdgeFadeFingerprint ?? null,
      };
    }

    const fadeFingerprint = `${held}|fade|${current.fingerprint}`;
    const alreadyCautioned =
      previous.lastEdgeFadeFingerprint === fadeFingerprint;

    if (exitedHeld && !alreadyCautioned) {
      return {
        notify: true,
        kinds: ['EDGE_FADE'],
        alertTone: 'caution',
        exitReason:
          'Setup cooled off — edge fading. Hold unless stop hits; wait for hard exit confirmation.',
        awaitingExitConfirmation: false,
        awaitingOppositeExitConfirmation: false,
        awaitingHardExitConfirmation: belowFloor && telemetry.hardDecayVeto,
        lastEdgeFadeFingerprint: fadeFingerprint,
      };
    }

    return {
      notify: false,
      kinds: exitedHeld ? ['ACTION'] : [],
      alertTone: 'standard',
      exitReason: null,
      awaitingExitConfirmation: false,
      awaitingOppositeExitConfirmation: false,
      awaitingHardExitConfirmation:
        belowFloor && telemetry.hardDecayVeto && !exitStreakReady,
      lastEdgeFadeFingerprint: previous.lastEdgeFadeFingerprint ?? null,
    };
  }

  return null;
}

/** Engaged exit policy only trusts a live Fyers open leg (not entry-intent alerts). */
export function resolveHeldDirectionFromOpenPositions(
  openDirections: HeldDirection[],
): HeldDirection | null {
  const unique = [...new Set(openDirections)];
  if (unique.length === 1) return unique[0];
  return null;
}

export async function resolveEngagedHeldDirection(
  fastify: FastifyInstance,
  params: {
    indexSymbol: string;
  },
): Promise<HeldDirection | null> {
  const positions = await fetchOpenIndexOptionPositions(fastify, [
    params.indexSymbol,
  ]);
  const openDirs = positions
    .filter((p) => p.indexSymbol === params.indexSymbol)
    .map((p) => p.direction);

  return resolveHeldDirectionFromOpenPositions(openDirs);
}