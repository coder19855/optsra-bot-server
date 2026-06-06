import {
  SignalChangeKind,
  SignalChangeResult,
  SignalSnapshot,
  TradeDecisionAlertPayload,
} from '../types/telegram-notifications';
import { TradeBias } from '../types/trade-decision';
import { TradingStyle } from '../types/trading-style';

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
  };
}

export function detectSignalChange(
  previous: SignalSnapshot | null,
  current: SignalSnapshot,
  options?: { minConvictionForInitial?: number },
): SignalChangeResult {
  const kinds: SignalChangeKind[] = [];
  const minInitial = options?.minConvictionForInitial ?? 0;

  if (!previous) {
    const actionable =
      current.action !== 'NO-TRADE' &&
      current.shouldConsiderTrade &&
      current.conviction >= minInitial;
    if (actionable) kinds.push('INITIAL');
    return {
      shouldNotify: actionable,
      kinds,
      previous,
      current,
    };
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

  const exitedTrade =
    previous.action !== 'NO-TRADE' && current.action === 'NO-TRADE';
  const enteredDirectional =
    previous.action === 'NO-TRADE' &&
    (current.action === 'CE-BUY' || current.action === 'PE-BUY');
  const flippedDirection =
    (previous.action === 'CE-BUY' && current.action === 'PE-BUY') ||
    (previous.action === 'PE-BUY' && current.action === 'CE-BUY');

  const shouldNotify =
    kinds.length > 0 &&
    (exitedTrade ||
      enteredDirectional ||
      flippedDirection ||
      current.shouldConsiderTrade ||
      current.action === 'NEUTRAL');

  return { shouldNotify, kinds, previous, current };
}

export function isIndianMarketOpen(
  now = Date.now(),
  timezone = 'Asia/Kolkata',
  sessionOpen = { hour: 9, minute: 15 },
  sessionClose = { hour: 15, minute: 30 },
): boolean {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(now));

  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';
  if (weekday === 'Sat' || weekday === 'Sun') return false;

  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  const mins = hour * 60 + minute;
  const openMins = sessionOpen.hour * 60 + sessionOpen.minute;
  const closeMins = sessionClose.hour * 60 + sessionClose.minute;

  return mins >= openMins && mins <= closeMins;
}