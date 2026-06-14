import { TELEGRAM_NOTIFICATION_DEFAULTS } from '../constants/telegram-notifications';

export interface FlipExitSignal {
  tsMs: number;
  oppositeAction: 'CE-BUY' | 'PE-BUY';
  conviction: number;
}

export interface EnginePollRead {
  asOfMs: number;
  dayKey?: string;
  action: string;
  conviction: number;
}

export function isOppositeDirection(
  entryAction: 'CE-BUY' | 'PE-BUY',
  readAction: string,
): boolean {
  return (
    (entryAction === 'CE-BUY' && readAction === 'PE-BUY') ||
    (entryAction === 'PE-BUY' && readAction === 'CE-BUY')
  );
}

export function isStrongOppositeSignal(
  entryAction: 'CE-BUY' | 'PE-BUY',
  read: Pick<EnginePollRead, 'action' | 'conviction'>,
  enterThreshold: number,
): boolean {
  return (
    isOppositeDirection(entryAction, read.action) &&
    read.conviction >= enterThreshold
  );
}

/**
 * First opposite flip after `minOppositePolls` consecutive strong opposite reads.
 * Matches live SIGNAL_OPPOSITE_CONFIRM_POLLS streak semantics.
 */
export function findFirstConfirmedFlipExit(
  entryMs: number,
  entryAction: 'CE-BUY' | 'PE-BUY',
  untilMs: number,
  reads: EnginePollRead[],
  enterThreshold: number,
  minOppositePolls: number = TELEGRAM_NOTIFICATION_DEFAULTS.SIGNAL_OPPOSITE_CONFIRM_POLLS,
): FlipExitSignal | null {
  const afterEntry = reads
    .filter((r) => r.asOfMs > entryMs && r.asOfMs <= untilMs)
    .sort((a, b) => a.asOfMs - b.asOfMs);

  let streak = 0;
  let lastOpposite: 'CE-BUY' | 'PE-BUY' | null = null;

  for (const read of afterEntry) {
    if (isStrongOppositeSignal(entryAction, read, enterThreshold)) {
      const opposite = read.action as 'CE-BUY' | 'PE-BUY';
      streak = lastOpposite === opposite ? streak + 1 : 1;
      lastOpposite = opposite;
      if (streak >= minOppositePolls) {
        return {
          tsMs: read.asOfMs,
          oppositeAction: opposite,
          conviction: read.conviction,
        };
      }
    } else {
      streak = 0;
      lastOpposite = null;
    }
  }

  return null;
}

export function buildFlipExitSignals(
  entryMs: number,
  entryAction: 'CE-BUY' | 'PE-BUY',
  untilSec: number,
  reads: EnginePollRead[],
  enterThreshold: number,
  minOppositePolls: number = TELEGRAM_NOTIFICATION_DEFAULTS.SIGNAL_OPPOSITE_CONFIRM_POLLS,
): FlipExitSignal[] {
  const untilMs = untilSec * 1000;
  const confirmed = findFirstConfirmedFlipExit(
    entryMs,
    entryAction,
    untilMs,
    reads,
    enterThreshold,
    minOppositePolls,
  );
  return confirmed ? [confirmed] : [];
}

export function computeOppositeExitStreak(
  heldDirection: 'CE-BUY' | 'PE-BUY',
  currentAction: string,
  conviction: number,
  enterThreshold: number,
  previousStreak: number,
): { streak: number; confirmed: boolean; awaitingConfirmation: boolean } {
  if (!isStrongOppositeSignal(heldDirection, { action: currentAction, conviction }, enterThreshold)) {
    return { streak: 0, confirmed: false, awaitingConfirmation: false };
  }

  const minPolls = TELEGRAM_NOTIFICATION_DEFAULTS.SIGNAL_OPPOSITE_CONFIRM_POLLS;
  const streak = previousStreak + 1;
  return {
    streak,
    confirmed: streak >= minPolls,
    awaitingConfirmation: streak > 0 && streak < minPolls,
  };
}