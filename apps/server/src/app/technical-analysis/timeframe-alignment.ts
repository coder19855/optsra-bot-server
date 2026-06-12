import { Timeframe } from '../types/technical-analysis';

export type TimeframeScores = Record<Timeframe, number>;

/** Count TFs sharing the primary timeframe's direction (matches decision engine). */
export function countAlignedTimeframes(
  scores: TimeframeScores,
  primaryTimeframe: Timeframe,
): number {
  const primaryScore = scores[primaryTimeframe] ?? 0;
  const primarySign = Math.sign(primaryScore);
  let aligned = 0;
  for (const tf of ['5m', '15m', '1h'] as const) {
    const sign = Math.sign(scores[tf] ?? 0);
    if (primarySign === 0 || sign === primarySign) aligned++;
  }
  return aligned;
}

/** Whether 1h structure supports the primary timeframe direction (display + conviction). */
export function isHigherTfSupportive(
  scores: TimeframeScores,
  primaryTimeframe: Timeframe,
  ms1h?: number,
): boolean {
  const primaryScore = scores[primaryTimeframe] ?? 0;
  const primarySign = Math.sign(primaryScore);
  const score1h = scores['1h'] ?? 0;

  if (primaryTimeframe === '1h') {
    return Math.abs(primaryScore) > 0.1;
  }

  return (
    (Math.sign(score1h) === primarySign && Math.abs(score1h) > 0.15) ||
    (primarySign !== 0 && ms1h === primarySign)
  );
}

/** Map 0–3 aligned count to a -1..1 gauge needle. */
export function alignmentToGaugeValue(aligned: number, total = 3): number {
  const clamped = Math.max(0, Math.min(total, aligned));
  if (total <= 0) return 0;
  return (clamped / total) * 2 - 1;
}

/** Deck needle for 1h vs primary — tri-state when no active trade. */
export function higherTfToGaugeValue(
  supported: boolean,
  scores: TimeframeScores,
  primaryTimeframe: Timeframe,
): number {
  if (supported) return 0.6;

  const primaryScore = scores[primaryTimeframe] ?? 0;
  const primarySign = Math.sign(primaryScore);
  const score1h = scores['1h'] ?? 0;
  const h1Sign = Math.sign(score1h);

  if (primarySign !== 0 && h1Sign === primarySign && Math.abs(score1h) > 0.1) {
    return 0.35;
  }
  if (primarySign !== 0 && h1Sign === -primarySign && Math.abs(score1h) > 0.1) {
    return -0.35;
  }
  if (Math.abs(score1h) > 0.1) {
    return Math.max(-1, Math.min(1, score1h));
  }
  return 0;
}