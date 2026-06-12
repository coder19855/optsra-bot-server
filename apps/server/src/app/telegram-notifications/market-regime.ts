import {
  ConfluenceContext,
  TrendQuality,
} from '../types/technical-analysis';
import { TradingStyle } from '../types/trading-style';

export type MarketRegimeKind = 'trending' | 'transitional' | 'sideways';
export type MarketRegimeDirection = 'up' | 'down' | 'flat';

export interface MarketRegimeInput {
  symbol: string;
  tradingStyle: TradingStyle;
  mtfScore?: number;
  aligned?: number;
  confluenceContext?: ConfluenceContext;
}

export interface DeckMarketRegime {
  kind: MarketRegimeKind;
  direction: MarketRegimeDirection;
  arrow: '↑' | '↓' | '↔';
  label: string;
  hint: string;
  /** Raw poll read before hysteresis — useful when confirming a flip. */
  rawKind: MarketRegimeKind;
  confirming: boolean;
  pollsInRegime: number;
  suggestedPaWeight: number;
  suggestedOptionWeight: number;
  suggestedVeto: 'strict' | 'relaxed' | 'blend-confirm';
}

interface RegimeState {
  kind: MarketRegimeKind;
  direction: MarketRegimeDirection;
  candidateKind: MarketRegimeKind | null;
  candidateStreak: number;
  pollsInRegime: number;
}

const regimeStore = new Map<string, RegimeState>();

function storeKey(symbol: string, style: TradingStyle): string {
  return `${symbol}:${style}`;
}

function pollsRequired(from: MarketRegimeKind, to: MarketRegimeKind): number {
  if (from === to) return 0;
  if (from === 'trending' && to === 'sideways') return 2;
  if (from === 'sideways' && to === 'trending') return 4;
  if (from === 'transitional' || to === 'transitional') return 3;
  return 3;
}

function dominantTrendQuality(tq: TrendQuality | undefined): number {
  if (!tq) return 0;
  return Math.max(tq.bullish, tq.bearish);
}

function resolveDirection(params: {
  mtfScore: number;
  trendQuality?: TrendQuality;
}): MarketRegimeDirection {
  const { mtfScore, trendQuality } = params;
  if (Math.abs(mtfScore) >= 0.1) {
    return mtfScore > 0 ? 'up' : 'down';
  }
  if (!trendQuality) return 'flat';
  if (trendQuality.bullish > trendQuality.bearish + 0.08) return 'up';
  if (trendQuality.bearish > trendQuality.bullish + 0.08) return 'down';
  return 'flat';
}

function scoreRegime(input: MarketRegimeInput): {
  rawKind: MarketRegimeKind;
  direction: MarketRegimeDirection;
} {
  const ctx = input.confluenceContext;
  const tq = ctx?.trendQuality;
  const session = ctx?.session;
  const volatility = ctx?.volatility;
  const mtfScore = input.mtfScore ?? 0;
  const aligned = input.aligned ?? 0;
  const dominant = dominantTrendQuality(tq);

  let trendingScore = 0;
  let sidewaysScore = 0;

  if (tq?.label === 'strong') trendingScore += 3;
  else if (tq?.label === 'moderate') trendingScore += 2;
  else if (tq?.label === 'weak') sidewaysScore += 1.5;
  else if (tq?.label === 'choppy') sidewaysScore += 3;

  if (aligned >= 2) trendingScore += 2;
  else if (aligned <= 1) sidewaysScore += 2;

  if (Math.abs(mtfScore) >= 0.25) trendingScore += 2;
  else if (Math.abs(mtfScore) < 0.12) sidewaysScore += 2;

  if (session?.phase === 'midday' && dominant < 0.45) {
    sidewaysScore += 2;
  }

  if (volatility?.isDeadMarket) {
    sidewaysScore += 3;
  }

  if (volatility?.sessionPhase === 'compression') {
    sidewaysScore += 1;
  }

  const rawKind: MarketRegimeKind =
    sidewaysScore >= trendingScore + 2
      ? 'sideways'
      : trendingScore >= sidewaysScore + 2
        ? 'trending'
        : 'transitional';

  const direction = resolveDirection({ mtfScore, trendQuality: tq });

  return { rawKind, direction };
}

function arrowFor(direction: MarketRegimeDirection): '↑' | '↓' | '↔' {
  if (direction === 'up') return '↑';
  if (direction === 'down') return '↓';
  return '↔';
}

function labelFor(
  kind: MarketRegimeKind,
  direction: MarketRegimeDirection,
): string {
  if (kind === 'sideways') return 'Sideways';
  if (kind === 'transitional') return 'Transitional';
  if (direction === 'up') return 'Trending up';
  if (direction === 'down') return 'Trending down';
  return 'Trending';
}

function hintFor(kind: MarketRegimeKind): string {
  if (kind === 'trending') {
    return 'PA-led · strict veto · option as light filter';
  }
  if (kind === 'sideways') {
    return 'PA + options blend · require alignment · stricter entry';
  }
  return 'Balanced blend · watch for regime shift';
}

function weightsFor(kind: MarketRegimeKind): {
  pa: number;
  option: number;
  veto: DeckMarketRegime['suggestedVeto'];
} {
  if (kind === 'trending') {
    return { pa: 0.82, option: 0.18, veto: 'strict' };
  }
  if (kind === 'sideways') {
    return { pa: 0.5, option: 0.5, veto: 'blend-confirm' };
  }
  return { pa: 0.65, option: 0.35, veto: 'relaxed' };
}

function applyHysteresis(
  key: string,
  rawKind: MarketRegimeKind,
  direction: MarketRegimeDirection,
): RegimeState {
  const prev = regimeStore.get(key);
  if (!prev) {
    const next: RegimeState = {
      kind: rawKind,
      direction,
      candidateKind: null,
      candidateStreak: 0,
      pollsInRegime: 1,
    };
    regimeStore.set(key, next);
    return next;
  }

  if (rawKind === prev.kind) {
    const next: RegimeState = {
      ...prev,
      direction,
      candidateKind: null,
      candidateStreak: 0,
      pollsInRegime: prev.pollsInRegime + 1,
    };
    regimeStore.set(key, next);
    return next;
  }

  const candidateKind = rawKind;
  const sameCandidate = prev.candidateKind === candidateKind;
  const candidateStreak = sameCandidate ? prev.candidateStreak + 1 : 1;
  const required = pollsRequired(prev.kind, candidateKind);

  if (candidateStreak >= required) {
    const next: RegimeState = {
      kind: candidateKind,
      direction,
      candidateKind: null,
      candidateStreak: 0,
      pollsInRegime: 1,
    };
    regimeStore.set(key, next);
    return next;
  }

  const next: RegimeState = {
    ...prev,
    direction,
    candidateKind,
    candidateStreak,
    pollsInRegime: prev.pollsInRegime + 1,
  };
  regimeStore.set(key, next);
  return next;
}

export function resolveDeckMarketRegime(
  input: MarketRegimeInput,
): DeckMarketRegime {
  const { rawKind, direction } = scoreRegime(input);
  const key = storeKey(input.symbol, input.tradingStyle);
  const stable = applyHysteresis(key, rawKind, direction);
  const weights = weightsFor(stable.kind);
  const confirming =
    stable.candidateKind != null && stable.candidateStreak > 0;

  return {
    kind: stable.kind,
    direction: stable.direction,
    arrow: arrowFor(stable.direction),
    label: labelFor(stable.kind, stable.direction),
    hint: hintFor(stable.kind),
    rawKind,
    confirming,
    pollsInRegime: stable.pollsInRegime,
    suggestedPaWeight: weights.pa,
    suggestedOptionWeight: weights.option,
    suggestedVeto: weights.veto,
  };
}

/** Test helper — clears in-memory hysteresis between cases. */
export function resetMarketRegimeStore(): void {
  regimeStore.clear();
}