import { SignalSnapshot } from '../types/telegram-notifications';
import {
  ChartPatternId,
  PatternStatus,
  Timeframe,
} from '../types/technical-analysis';

const INSTANT_CONFIRMED_PATTERNS: ChartPatternId[] = [
  'range_breakout_bull',
  'range_breakout_bear',
  'trendline_break_bull',
  'trendline_break_bear',
];

export function buildPatternBreakoutKey(params: {
  pattern: ChartPatternId;
  status: PatternStatus;
  timeframe: Timeframe;
}): string {
  return `${params.pattern}|${params.status}|${params.timeframe}`;
}

export interface PatternBreakoutResult {
  shouldNotify: boolean;
  breakoutKey?: string;
}

/** Dedicated chart-pattern breakout — separate from CE/PE direction alerts. */
export function detectChartPatternBreakout(
  previous: SignalSnapshot | null,
  current: SignalSnapshot,
): PatternBreakoutResult {
  const pattern = current.chartPattern;
  const status = current.chartPatternStatus;

  if (!pattern || pattern === 'none' || status !== 'confirmed') {
    return { shouldNotify: false };
  }

  if (!previous) {
    return { shouldNotify: false };
  }

  const timeframe = current.chartPatternTimeframe ?? '15m';
  const breakoutKey = buildPatternBreakoutKey({
    pattern,
    status,
    timeframe,
  });

  if (previous.lastNotifiedPatternBreakoutKey === breakoutKey) {
    return { shouldNotify: false };
  }

  if (
    previous.chartPattern === pattern &&
    previous.chartPatternStatus === 'forming'
  ) {
    return { shouldNotify: true, breakoutKey };
  }

  if (INSTANT_CONFIRMED_PATTERNS.includes(pattern)) {
    const wasSameConfirmed =
      previous.chartPattern === pattern &&
      previous.chartPatternStatus === 'confirmed';
    if (!wasSameConfirmed) {
      return { shouldNotify: true, breakoutKey };
    }
  }

  return { shouldNotify: false };
}