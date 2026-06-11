import { TradingStyle } from './trading-style';

export interface OptionChainComponentSnapshot {
  id: string;
  name: string;
  score: number;
  interpretation?: string;
  weightage?: number;
}

export interface OptionChainSnapshotRecord {
  symbol: string;
  tradingStyle: TradingStyle;
  /** IST-aligned bucket start (ms floored to flush interval). */
  bucketAt: Date;
  capturedAt: Date;
  spotLtp: number;
  overallScore: number;
  bias: string;
  optionConviction: number;
  components: OptionChainComponentSnapshot[];
  /** TTL helper — Mongo removes docs after this instant. */
  expiresAt: Date;
}

export interface OptionChainSnapshotInput {
  symbol: string;
  tradingStyle: TradingStyle;
  spotLtp: number;
  overallScore: number;
  bias: string;
  optionConviction: number;
  components: OptionChainComponentSnapshot[];
}