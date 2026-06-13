import { FyersTrackedMethod } from '../constants/fyers-usage';

export type FyersUsageHealth = 'ok' | 'warning' | 'critical';

export interface FyersPollUsageSnapshot {
  at: string;
  total: number;
  byMethod: Partial<Record<FyersTrackedMethod, number>>;
  durationMs: number | null;
  scope: string;
}

export interface FyersUsageResponse {
  limits: {
    perSecond: number;
    perMinute: number;
    perDay: number;
  };
  istSessionDate: string;
  totals: {
    sinceServerStart: number;
    sessionToday: number;
    byMethodSession: Partial<Record<FyersTrackedMethod, number>>;
  };
  rolling: {
    last60Seconds: number;
    last60SecondsByMethod: Partial<Record<FyersTrackedMethod, number>>;
    estimatedPerMinuteFromLastPoll: number | null;
  };
  lastTelegramPoll: FyersPollUsageSnapshot | null;
  recentTelegramPolls: FyersPollUsageSnapshot[];
  headroom: {
    perMinuteRemaining: number;
    perDayRemaining: number;
    perMinuteUtilizationPercent: number;
    perDayUtilizationPercent: number;
    perSecondBurstNote: string;
  };
  health: FyersUsageHealth;
  notes: string[];
}