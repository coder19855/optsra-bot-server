import { DecisionAction } from '../types/trade-decision';

export interface DeckGaugeReading {
  value: number;
  percent: number;
  ghost: number | null;
  label: string;
}

export interface DeckGauges {
  option: DeckGaugeReading;
  priceAction: DeckGaugeReading;
  aligned: boolean;
  conflict: boolean;
}

function clampNeedle(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

function needleLabel(value: number): string {
  if (value >= 0.35) return 'CE';
  if (value <= -0.35) return 'PE';
  return 'FLAT';
}

export function optionFlowSign(
  action: DecisionAction,
  optionBias: string,
): number {
  if (action === 'CE-BUY') return 1;
  if (action === 'PE-BUY') return -1;
  const bias = optionBias.toLowerCase();
  if (bias.includes('bull')) return 1;
  if (bias.includes('bear')) return -1;
  return 0;
}

export function computeOptionNeedle(
  action: DecisionAction,
  optionConviction: number,
  optionBias: string,
): number {
  const sign = optionFlowSign(action, optionBias);
  if (sign === 0) return 0;
  const magnitude = Math.min(100, Math.max(0, optionConviction)) / 100;
  return clampNeedle(sign * magnitude);
}

/** Prefer the weighted option-chain composite (-100..100) over trade-action sign. */
export function computeOptionNeedleFromOverallScore(
  optionOverallScore: number | undefined,
  action: DecisionAction,
  optionConviction: number,
  optionBias: string,
): { value: number; percent: number } {
  if (
    optionOverallScore != null &&
    Number.isFinite(optionOverallScore) &&
    Math.abs(optionOverallScore) >= 2
  ) {
    return {
      value: clampNeedle(optionOverallScore / 100),
      percent: Math.round(Math.min(100, Math.abs(optionOverallScore))),
    };
  }

  return {
    value: computeOptionNeedle(action, optionConviction, optionBias),
    percent: optionConviction,
  };
}

/**
 * Replay scrub: timeline points often veto to NO-TRADE with 0% confidence even when
 * structure was directional. Fall back to structuralAction / primary PA score.
 */
export function computeReplayOptionNeedle(
  point: {
    signal: {
      action: string;
      confidence: number;
      structuralAction?: string;
    };
    timeframeScores: Record<string, number>;
    mtfScore: number;
  },
  primaryTf: '5m' | '15m' | '1h',
): number {
  const primaryScore =
    point.timeframeScores[primaryTf] ?? point.mtfScore ?? 0;

  let direction = point.signal.action;
  if (direction === 'NO-TRADE' || direction === 'NEUTRAL') {
    const structural = point.signal.structuralAction;
    if (structural === 'CE-BUY' || structural === 'PE-BUY') {
      direction = structural;
    } else if (Math.abs(primaryScore) >= 0.1) {
      direction = primaryScore > 0 ? 'CE-BUY' : 'PE-BUY';
    } else {
      return 0;
    }
  }

  let magnitude: number;
  if (point.signal.action !== 'NO-TRADE' && point.signal.confidence > 0) {
    magnitude = point.signal.confidence / 100;
  } else {
    magnitude = Math.min(0.85, Math.max(0.1, Math.abs(primaryScore)));
  }

  const sign = direction === 'CE-BUY' ? 1 : -1;
  return clampNeedle(sign * magnitude);
}

export function computePaNeedle(primaryScore: number): number {
  return clampNeedle(primaryScore);
}

export function computePaNeedleFromConviction(
  conviction: number,
  primaryScore: number,
): number {
  if (primaryScore === 0) return 0;
  const sign = primaryScore > 0 ? 1 : -1;
  const magnitude = Math.min(100, Math.max(0, conviction)) / 100;
  return clampNeedle(sign * magnitude);
}

export function buildDeckGauges(params: {
  action: DecisionAction;
  optionConviction: number;
  optionBias: string;
  optionOverallScore?: number;
  priceConviction: number;
  priceConvictionBeforeDecay?: number;
  primaryScore: number;
  hasMomentumDecay?: boolean;
}): DeckGauges {
  const optionReading = computeOptionNeedleFromOverallScore(
    params.optionOverallScore,
    params.action,
    params.optionConviction,
    params.optionBias,
  );
  const optionValue = optionReading.value;
  const paValue = computePaNeedle(params.primaryScore);
  let paGhost: number | null = null;
  if (
    params.hasMomentumDecay &&
    params.priceConvictionBeforeDecay != null &&
    params.priceConvictionBeforeDecay !== params.priceConviction
  ) {
    paGhost = computePaNeedleFromConviction(
      params.priceConvictionBeforeDecay,
      params.primaryScore,
    );
  }

  const sameSide =
    optionValue === 0 ||
    paValue === 0 ||
    Math.sign(optionValue) === Math.sign(paValue);
  const conflict =
    optionValue !== 0 &&
    paValue !== 0 &&
    Math.sign(optionValue) !== Math.sign(paValue);

  return {
    option: {
      value: optionValue,
      percent: optionReading.percent,
      ghost: null,
      label: needleLabel(optionValue),
    },
    priceAction: {
      value: paValue,
      percent: params.priceConviction,
      ghost: paGhost,
      label: needleLabel(paValue),
    },
    aligned: sameSide && !conflict,
    conflict,
  };
}