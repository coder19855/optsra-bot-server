import { TELEGRAM_NOTIFICATION_DEFAULTS } from '../constants/telegram-notifications';
import {
  SignalChangeKind,
  SignalChangeResult,
  SignalSnapshot,
  TradeDecisionAlertPayload,
} from '../types/telegram-notifications';
import { DecisionAction } from '../types/trade-decision';
import { TradeBias } from '../types/trade-decision';
import { TradingStyle } from '../types/trading-style';
import {
  evaluateEngagedExitDecision,
  SignalEngagementContext,
  SignalExitTelemetry,
} from './signal-exit-policy';

function isDirectionalAction(action: DecisionAction): boolean {
  return action === 'CE-BUY' || action === 'PE-BUY';
}

export function computeDirectionalStreak(
  previous: SignalSnapshot | null,
  currentAction: DecisionAction,
): number {
  if (!isDirectionalAction(currentAction)) return 0;
  if (previous?.action === currentAction) {
    return (previous.directionalStreak ?? 1) + 1;
  }
  return 1;
}

export function computeNoTradeStreak(
  previous: SignalSnapshot | null,
  currentAction: DecisionAction,
): number {
  if (currentAction !== 'NO-TRADE') return 0;
  if (previous?.action === 'NO-TRADE') {
    return (previous.noTradeStreak ?? 1) + 1;
  }
  return 1;
}

/** Mongo JSON often stores dates as strings — normalize before grace math. */
export function hydrateSignalSnapshot(
  snapshot: SignalSnapshot,
): SignalSnapshot {
  return {
    ...snapshot,
    updatedAt: new Date(snapshot.updatedAt),
    lastNotifiedAt: snapshot.lastNotifiedAt
      ? new Date(snapshot.lastNotifiedAt)
      : undefined,
  };
}

export function snapshotKey(symbol: string, tradingStyle: TradingStyle): string {
  return `${symbol}:${tradingStyle}`;
}

export function buildSignalFingerprint(snapshot: {
  action: string;
  paAction: string;
  bias: string;
  shouldConsiderTrade: boolean;
  topStrategy: string | null;
}): string {
  return [
    snapshot.action,
    snapshot.paAction,
    snapshot.bias,
    snapshot.shouldConsiderTrade ? '1' : '0',
    snapshot.topStrategy || '',
  ].join('|');
}

function biasCamp(bias: TradeBias): 'bullish' | 'bearish' | 'neutral' {
  if (bias.includes('Bullish')) return 'bullish';
  if (bias.includes('Bearish')) return 'bearish';
  return 'neutral';
}

function isEntryConfirmPoll(
  previous: SignalSnapshot,
  current: SignalSnapshot,
  entryStreakReady: boolean,
): boolean {
  return (
    Boolean(previous.awaitingEntryConfirmation) &&
    entryStreakReady &&
    isDirectionalAction(current.action) &&
    previous.action === current.action
  );
}

function isExitConfirmPoll(
  previous: SignalSnapshot,
  current: SignalSnapshot,
  exitStreakReady: boolean,
  skipFlatExit: boolean,
): boolean {
  return (
    !skipFlatExit &&
    Boolean(previous.awaitingExitConfirmation) &&
    exitStreakReady &&
    current.action === 'NO-TRADE'
  );
}

/** Entry/exit alerts fire on direction change — not bias/strategy/PA tweaks. */
function shouldNotifyActionChange(
  previous: SignalSnapshot,
  current: SignalSnapshot,
  params: {
    entryStreakReady: boolean;
    exitStreakReady: boolean;
    skipFlatExit: boolean;
    notify: boolean;
  },
): boolean {
  if (!params.notify) return false;

  if (
    isEntryConfirmPoll(previous, current, params.entryStreakReady) ||
    isExitConfirmPoll(
      previous,
      current,
      params.exitStreakReady,
      params.skipFlatExit,
    )
  ) {
    return true;
  }

  return previous.action !== current.action;
}

export function buildSignalSnapshot(
  payload: TradeDecisionAlertPayload,
): SignalSnapshot {
  const topStrategy = payload.recommendedStrategies[0]?.strategy ?? null;
  const paAction = payload.priceAction.action;
  const fingerprint = buildSignalFingerprint({
    action: payload.action,
    paAction,
    bias: payload.bias,
    shouldConsiderTrade: payload.tradeGuidance.shouldConsiderTrade,
    topStrategy,
  });

  return {
    key: snapshotKey(payload.symbol, payload.tradingStyle),
    symbol: payload.symbol,
    tradingStyle: payload.tradingStyle,
    action: payload.action,
    paAction,
    bias: payload.bias,
    conviction: payload.conviction,
    shouldConsiderTrade: payload.tradeGuidance.shouldConsiderTrade,
    topStrategy,
    lastPrice: payload.lastPrice,
    recommendation: payload.recommendation,
    humanSummary: payload.humanSummary,
    fingerprint,
    updatedAt: new Date(),
    chartPattern: payload.chartPattern?.pattern,
    chartPatternStatus: payload.chartPattern?.status,
    chartPatternTimeframe: payload.chartPattern?.timeframe,
  };
}

export function detectSignalChange(
  previous: SignalSnapshot | null,
  current: SignalSnapshot,
  options?: {
    minConvictionForInitial?: number;
    minDirectionalStreakForEntry?: number;
    minNoTradeStreakForExit?: number;
    engagement?: SignalEngagementContext;
    telemetry?: SignalExitTelemetry;
    minOppositePolls?: number;
  },
): SignalChangeResult {
  const liveEngaged = !!options?.engagement?.engaged && !!options?.telemetry;

  if (liveEngaged) {
    // Use live Fyers open leg as the source of truth for "we are managing, not entering".
    // Do NOT require a previous snapshot — this fixes restarts / first-seen-while-holding cases.
    const engaged = evaluateEngagedExitDecision({
      previous: previous || current, // fall back to current snapshot if none; the policy mainly looks at current + held
      current,
      engagement: options!.engagement!,
      telemetry: options!.telemetry!,
      minExitPolls:
        options!.minNoTradeStreakForExit ??
        TELEGRAM_NOTIFICATION_DEFAULTS.SIGNAL_EXIT_CONFIRM_POLLS,
      minOppositePolls:
        options!.minOppositePolls ??
        TELEGRAM_NOTIFICATION_DEFAULTS.SIGNAL_OPPOSITE_CONFIRM_POLLS,
    });

    if (engaged) {
      return {
        shouldNotify: engaged.notify && engaged.kinds.length > 0,
        kinds: engaged.kinds,
        previous: previous || current,
        current,
        alertTone: engaged.alertTone,
        exitReason: engaged.exitReason,
        engagedFlags: {
          awaitingHardExitConfirmation: engaged.awaitingHardExitConfirmation,
          awaitingOppositeExitConfirmation:
            engaged.awaitingOppositeExitConfirmation,
          lastEdgeFadeFingerprint: engaged.lastEdgeFadeFingerprint,
        },
      };
    }

    // Open leg on book — only qualified exit-policy alerts may fire.
    // This prevents "buy again" or "NO-TRADE / stop trading" spam while holding.
    return { shouldNotify: false, kinds: [], previous: previous || current, current };
  }

  // Legacy path (no live engagement detected)
  if (previous && options?.engagement?.engaged && options.telemetry) {
    const engaged = evaluateEngagedExitDecision({
      previous,
      current,
      engagement: options.engagement,
      telemetry: options.telemetry,
      minExitPolls:
        options.minNoTradeStreakForExit ??
        TELEGRAM_NOTIFICATION_DEFAULTS.SIGNAL_EXIT_CONFIRM_POLLS,
      minOppositePolls:
        options.minOppositePolls ??
        TELEGRAM_NOTIFICATION_DEFAULTS.SIGNAL_OPPOSITE_CONFIRM_POLLS,
    });
    if (engaged) {
      return {
        shouldNotify: engaged.notify && engaged.kinds.length > 0,
        kinds: engaged.kinds,
        previous,
        current,
        alertTone: engaged.alertTone,
        exitReason: engaged.exitReason,
        engagedFlags: {
          awaitingHardExitConfirmation: engaged.awaitingHardExitConfirmation,
          awaitingOppositeExitConfirmation:
            engaged.awaitingOppositeExitConfirmation,
          lastEdgeFadeFingerprint: engaged.lastEdgeFadeFingerprint,
        },
      };
    }

    // Open leg on book — only exit-policy alerts (above) may fire; skip re-entry copy.
    return { shouldNotify: false, kinds: [], previous, current };
  }

  const skipFlatExit = options?.engagement?.engaged === true;
  const kinds: SignalChangeKind[] = [];
  const minInitial = options?.minConvictionForInitial ?? 0;
  const minEntryStreak = options?.minDirectionalStreakForEntry ?? 1;
  const minExitStreak = options?.minNoTradeStreakForExit ?? 1;

  const entryStreakReady =
    isDirectionalAction(current.action) &&
    current.shouldConsiderTrade &&
    current.conviction >= minInitial &&
    (current.directionalStreak ?? 0) >= minEntryStreak;

  const exitStreakReady =
    current.action === 'NO-TRADE' &&
    (current.noTradeStreak ?? 0) >= minExitStreak;

  if (!previous) {
    return { shouldNotify: false, kinds, previous, current };
  }

  if (isEntryConfirmPoll(previous, current, entryStreakReady)) {
    kinds.push('ACTION');
    return { shouldNotify: true, kinds, previous, current };
  }

  if (isExitConfirmPoll(previous, current, exitStreakReady, skipFlatExit)) {
    kinds.push('ACTION');
    return { shouldNotify: true, kinds, previous, current };
  }

  if (previous.fingerprint === current.fingerprint) {
    return { shouldNotify: false, kinds, previous, current };
  }

  if (previous.action !== current.action) kinds.push('ACTION');
  if (previous.paAction !== current.paAction && current.paAction !== 'NO-TRADE') {
    kinds.push('PA_SIGNAL');
  }
  if (biasCamp(previous.bias) !== biasCamp(current.bias)) kinds.push('BIAS');
  if (!previous.shouldConsiderTrade && current.shouldConsiderTrade) {
    kinds.push('TRADE_READY');
  }
  if (
    previous.topStrategy !== current.topStrategy &&
    current.shouldConsiderTrade &&
    current.action !== 'NO-TRADE'
  ) {
    kinds.push('STRATEGY');
  }

  const exitedDirectional =
    isDirectionalAction(previous.action) && current.action === 'NO-TRADE';
  const continuingExitConfirm =
    previous.action === 'NO-TRADE' &&
    current.action === 'NO-TRADE' &&
    Boolean(previous.awaitingExitConfirmation);
  const inExitConfirmPath =
    !skipFlatExit && (exitedDirectional || continuingExitConfirm);

  const exitedNonDirectional =
    previous.action !== 'NO-TRADE' &&
    current.action === 'NO-TRADE' &&
    !isDirectionalAction(previous.action);

  const enteredDirectional =
    previous.action === 'NO-TRADE' && isDirectionalAction(current.action);
  const flippedDirection =
    (previous.action === 'CE-BUY' && current.action === 'PE-BUY') ||
    (previous.action === 'PE-BUY' && current.action === 'CE-BUY');

  let notify = false;
  if (inExitConfirmPath) {
    notify = exitStreakReady;
  } else if (exitedNonDirectional) {
    notify = true;
  } else if (enteredDirectional || flippedDirection) {
    notify = entryStreakReady;
  } else if (current.action === 'NEUTRAL') {
    notify = true;
  } else if (current.shouldConsiderTrade) {
    notify = isDirectionalAction(current.action) ? entryStreakReady : true;
  }

  const shouldNotify =
    kinds.length > 0 &&
    shouldNotifyActionChange(previous, current, {
      entryStreakReady,
      exitStreakReady,
      skipFlatExit,
      notify,
    });

  return { shouldNotify, kinds, previous, current };
}

export interface IstSessionClock {
  weekday: string;
  hour: number;
  minute: number;
  mins: number;
  sessionDate: string;
}

export function getIstSessionClock(
  now = Date.now(),
  timezone = 'Asia/Kolkata',
): IstSessionClock {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(now));

  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  const sessionDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(now));

  return {
    weekday,
    hour,
    minute,
    mins: hour * 60 + minute,
    sessionDate,
  };
}

export function isIndianWeekday(
  now = Date.now(),
  timezone = 'Asia/Kolkata',
): boolean {
  const { weekday } = getIstSessionClock(now, timezone);
  return weekday !== 'Sat' && weekday !== 'Sun';
}

export function isIndianMarketOpen(
  now = Date.now(),
  timezone = 'Asia/Kolkata',
  sessionOpen = { hour: 9, minute: 15 },
  sessionClose = { hour: 15, minute: 30 },
): boolean {
  const { weekday, mins } = getIstSessionClock(now, timezone);
  if (weekday === 'Sat' || weekday === 'Sun') return false;

  const openMins = sessionOpen.hour * 60 + sessionOpen.minute;
  const closeMins = sessionClose.hour * 60 + sessionClose.minute;

  return mins >= openMins && mins <= closeMins;
}

/** Before the official open — window for the once-per-day pre-session learning brief. */
export function isWithinPreSessionLearningWindow(
  now = Date.now(),
  timezone = 'Asia/Kolkata',
  windowStart = { hour: 9, minute: 0 },
  windowEnd = { hour: 9, minute: 20 },
): boolean {
  if (!isIndianWeekday(now, timezone)) return false;

  const { mins } = getIstSessionClock(now, timezone);
  const startMins = windowStart.hour * 60 + windowStart.minute;
  const endMins = windowEnd.hour * 60 + windowEnd.minute;

  return mins >= startMins && mins <= endMins;
}

/** After the official close, while the server can still send the daily coach once. */
export function isWithinPostSessionCoachWindow(
  now = Date.now(),
  timezone = 'Asia/Kolkata',
  sessionClose = { hour: 15, minute: 30 },
  windowMinutes = 45,
): boolean {
  if (!isIndianWeekday(now, timezone)) return false;

  const { mins } = getIstSessionClock(now, timezone);
  const closeMins = sessionClose.hour * 60 + sessionClose.minute;
  const windowEnd = closeMins + windowMinutes;

  return mins > closeMins && mins <= windowEnd;
}