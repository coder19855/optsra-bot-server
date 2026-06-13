import { FastifyInstance } from 'fastify';
import { getStyleScoringConfig } from '../trading-style';
import {
  AdaptiveConvictionInsight,
  ConvictionBucketStat,
} from '../types/adaptive-conviction';
import { SignalOutcomeRecord } from '../types/alert-intelligence';
import { DecisionAction } from '../types/trade-decision';
import { TradingStyle } from '../types/trading-style';
import { loadClosedSignalOutcomes } from './signal-outcome-tracker';

const BUCKETS = [
  { rangeLabel: '35–45', min: 35, max: 45 },
  { rangeLabel: '45–55', min: 45, max: 55 },
  { rangeLabel: '55–65', min: 55, max: 65 },
  { rangeLabel: '65–75', min: 65, max: 75 },
  { rangeLabel: '75+', min: 75, max: 100 },
];

const MIN_SAMPLES_PER_BUCKET = 3;
const TARGET_WIN_RATE = 55;

function bucketize(records: SignalOutcomeRecord[]): ConvictionBucketStat[] {
  return BUCKETS.map((bucket) => {
    const inBucket = records.filter(
      (r) =>
        r.conviction >= bucket.min &&
        (bucket.max === 100 ? r.conviction >= bucket.min : r.conviction < bucket.max),
    );
    const wins = inBucket.filter((r) => r.status === 'win').length;
    const samples = inBucket.length;
    const winRate = samples > 0 ? Math.round((wins / samples) * 100) : 0;
    return { ...bucket, samples, winRate };
  });
}

function recommendThreshold(
  buckets: ConvictionBucketStat[],
  defaultEnter: number,
): number {
  const eligible = buckets.filter(
    (b) => b.samples >= MIN_SAMPLES_PER_BUCKET && b.winRate >= TARGET_WIN_RATE,
  );
  if (!eligible.length) return defaultEnter;
  return Math.min(...eligible.map((b) => b.min));
}

export async function computeAdaptiveConviction(
  fastify: FastifyInstance,
  params: {
    symbol: string;
    tradingStyle: TradingStyle;
    action: DecisionAction;
  },
): Promise<AdaptiveConvictionInsight> {
  const styleConfig = getStyleScoringConfig(params.tradingStyle);
  const defaultEnter = styleConfig.convictionThreshold.enter;

  const closed = await loadClosedSignalOutcomes(
    fastify,
    params.symbol,
    params.tradingStyle,
  );
  const relevant = closed.filter((r) => r.action === params.action);

  if (relevant.length < MIN_SAMPLES_PER_BUCKET) {
    return {
      symbol: params.symbol,
      tradingStyle: params.tradingStyle,
      action: params.action,
      defaultEnterThreshold: defaultEnter,
      recommendedEnterThreshold: defaultEnter,
      sampleSize: relevant.length,
      overallWinRate: null,
      buckets: bucketize(relevant),
      summary: `Not enough paper outcomes yet (${relevant.length}/${MIN_SAMPLES_PER_BUCKET}) — using default ${params.tradingStyle} enter threshold ${defaultEnter}%.`,
      dataSource: 'defaults',
    };
  }

  const buckets = bucketize(relevant);
  const recommended = recommendThreshold(buckets, defaultEnter);
  const wins = relevant.filter((r) => r.status === 'win').length;
  const overallWinRate = Math.round((wins / relevant.length) * 100);

  const delta = recommended - defaultEnter;
  const summary =
    recommended > defaultEnter
      ? `Your ${params.action} alerts on ${params.symbol} (${params.tradingStyle}) win ${overallWinRate}% overall — raise bar to ${recommended}% (+${delta} vs default ${defaultEnter}%).`
      : recommended < defaultEnter
        ? `Your ${params.action} alerts win ${overallWinRate}% — you can enter from ${recommended}% (${Math.abs(delta)} below default ${defaultEnter}%) based on recent paper outcomes.`
        : `Your ${params.action} alerts win ${overallWinRate}% — default ${defaultEnter}% threshold matches your recent paper outcomes.`;

  return {
    symbol: params.symbol,
    tradingStyle: params.tradingStyle,
    action: params.action,
    defaultEnterThreshold: defaultEnter,
    recommendedEnterThreshold: recommended,
    sampleSize: relevant.length,
    overallWinRate,
    buckets,
    summary,
    dataSource: 'signal_outcomes',
  };
}