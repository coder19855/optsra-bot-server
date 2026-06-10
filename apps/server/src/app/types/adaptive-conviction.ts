import { DecisionAction } from './trade-decision';
import { TradingStyle } from './trading-style';

export interface ConvictionBucketStat {
  rangeLabel: string;
  min: number;
  max: number;
  samples: number;
  winRate: number;
}

export interface AdaptiveConvictionInsight {
  symbol: string;
  tradingStyle: TradingStyle;
  action: DecisionAction;
  defaultEnterThreshold: number;
  recommendedEnterThreshold: number;
  sampleSize: number;
  overallWinRate: number | null;
  buckets: ConvictionBucketStat[];
  summary: string;
  dataSource: 'signal_outcomes' | 'defaults';
}