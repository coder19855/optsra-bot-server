import {
  FYERS_API_RATE_LIMITS,
  FYERS_TRACKED_METHODS,
  FYERS_USAGE_CRITICAL_MINUTE_PERCENT,
  FYERS_USAGE_WARN_MINUTE_PERCENT,
  FyersTrackedMethod,
} from '../constants/fyers-usage';
import {
  FyersPollUsageSnapshot,
  FyersUsageHealth,
  FyersUsageResponse,
} from '../types/fyers-usage';

interface CallRecord {
  at: number;
  method: FyersTrackedMethod;
  scope: string | null;
}

function istSessionDate(now = Date.now()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(now));
}

function emptyMethodMap(): Partial<Record<FyersTrackedMethod, number>> {
  return {};
}

export class FyersUsageTracker {
  private calls: CallRecord[] = [];
  private sinceStart = 0;
  private sessionDate = istSessionDate();
  private sessionTotal = 0;
  private sessionByMethod: Partial<Record<FyersTrackedMethod, number>> =
    emptyMethodMap();

  private activeScope: string | null = null;
  private scopeStartedAt: number | null = null;
  private scopeCounts: Partial<Record<FyersTrackedMethod, number>> =
    emptyMethodMap();

  private lastTelegramPoll: FyersPollUsageSnapshot | null = null;
  private recentTelegramPolls: FyersPollUsageSnapshot[] = [];

  record(method: FyersTrackedMethod): void {
    const now = Date.now();
    this.rotateSessionIfNeeded(now);
    this.pruneOldCalls(now);

    this.calls.push({
      at: now,
      method,
      scope: this.activeScope,
    });
    this.sinceStart += 1;
    this.sessionTotal += 1;
    this.sessionByMethod[method] = (this.sessionByMethod[method] ?? 0) + 1;

    if (this.activeScope) {
      this.scopeCounts[method] = (this.scopeCounts[method] ?? 0) + 1;
    }
  }

  beginScope(scope: string): void {
    this.activeScope = scope;
    this.scopeStartedAt = Date.now();
    this.scopeCounts = emptyMethodMap();
  }

  endScope(scope: string): void {
    if (this.activeScope !== scope) return;

    const total = Object.values(this.scopeCounts).reduce(
      (sum, n) => sum + (n ?? 0),
      0,
    );
    const snapshot: FyersPollUsageSnapshot = {
      at: new Date().toISOString(),
      total,
      byMethod: { ...this.scopeCounts },
      durationMs:
        this.scopeStartedAt != null
          ? Date.now() - this.scopeStartedAt
          : null,
      scope,
    };

    if (scope === 'telegram-poll') {
      this.lastTelegramPoll = snapshot;
      this.recentTelegramPolls = [snapshot, ...this.recentTelegramPolls].slice(
        0,
        10,
      );
    }

    this.activeScope = null;
    this.scopeStartedAt = null;
    this.scopeCounts = emptyMethodMap();
  }

  getStats(): FyersUsageResponse {
    const now = Date.now();
    this.rotateSessionIfNeeded(now);
    this.pruneOldCalls(now);

    const last60s = this.calls.filter((c) => c.at >= now - 60_000);
    const last60SecondsByMethod = emptyMethodMap();
    for (const call of last60s) {
      last60SecondsByMethod[call.method] =
        (last60SecondsByMethod[call.method] ?? 0) + 1;
    }

    const perMinuteRemaining = Math.max(
      0,
      FYERS_API_RATE_LIMITS.PER_MINUTE - last60s.length,
    );
    const perDayRemaining = Math.max(
      0,
      FYERS_API_RATE_LIMITS.PER_DAY - this.sessionTotal,
    );
    const perMinuteUtilizationPercent = +(
      (last60s.length / FYERS_API_RATE_LIMITS.PER_MINUTE) *
      100
    ).toFixed(2);
    const perDayUtilizationPercent = +(
      (this.sessionTotal / FYERS_API_RATE_LIMITS.PER_DAY) *
      100
    ).toFixed(2);

    let health: FyersUsageHealth = 'ok';
    if (
      perMinuteUtilizationPercent >= FYERS_USAGE_CRITICAL_MINUTE_PERCENT ||
      perDayUtilizationPercent >= FYERS_USAGE_CRITICAL_MINUTE_PERCENT
    ) {
      health = 'critical';
    } else if (
      perMinuteUtilizationPercent >= FYERS_USAGE_WARN_MINUTE_PERCENT ||
      perDayUtilizationPercent >= FYERS_USAGE_WARN_MINUTE_PERCENT
    ) {
      health = 'warning';
    }

    const notes = [
      'Counts include wrapped Fyers REST methods only (not local JWT/Mongo token checks).',
      `Tracked methods: ${FYERS_TRACKED_METHODS.join(', ')}.`,
      'last60Seconds is a rolling window — compare to per-minute limit of 200.',
      'estimatedPerMinuteFromLastPoll extrapolates the most recent telegram poll total.',
    ];

    return {
      limits: {
        perSecond: FYERS_API_RATE_LIMITS.PER_SECOND,
        perMinute: FYERS_API_RATE_LIMITS.PER_MINUTE,
        perDay: FYERS_API_RATE_LIMITS.PER_DAY,
      },
      istSessionDate: this.sessionDate,
      totals: {
        sinceServerStart: this.sinceStart,
        sessionToday: this.sessionTotal,
        byMethodSession: { ...this.sessionByMethod },
      },
      rolling: {
        last60Seconds: last60s.length,
        last60SecondsByMethod,
        estimatedPerMinuteFromLastPoll: this.lastTelegramPoll?.total ?? null,
      },
      lastTelegramPoll: this.lastTelegramPoll,
      recentTelegramPolls: [...this.recentTelegramPolls],
      headroom: {
        perMinuteRemaining,
        perDayRemaining,
        perMinuteUtilizationPercent,
        perDayUtilizationPercent,
        perSecondBurstNote:
          'REST bursts during a poll may issue several parallel calls for ~1–2s; stay under 10/sec.',
      },
      health,
      notes,
    };
  }

  private rotateSessionIfNeeded(now: number): void {
    const today = istSessionDate(now);
    if (today === this.sessionDate) return;
    this.sessionDate = today;
    this.sessionTotal = 0;
    this.sessionByMethod = emptyMethodMap();
  }

  private pruneOldCalls(now: number): void {
    const cutoff = now - 24 * 60 * 60 * 1000;
    if (this.calls.length < 5000) {
      this.calls = this.calls.filter((c) => c.at >= cutoff);
      return;
    }
    this.calls = this.calls.filter((c) => c.at >= cutoff);
  }
}