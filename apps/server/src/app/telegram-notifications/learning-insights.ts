import { FastifyInstance } from 'fastify';
import { TELEGRAM_NOTIFICATION_DEFAULTS } from '../constants/telegram-notifications';
import { runTradingCoachAnalysis } from '../trading-coach/analyze';
import { resolveCoachDateRange } from '../trading-coach/fyers-trades';
import {
  CoachVerdict,
  TradingCoachTradeReport,
} from '../types/trading-coach';
import { TradingStyle } from '../types/trading-style';
import { watchedStylesForCoach } from './coach-summary-formatter';

export interface LearningPattern {
  label: string;
  count: number;
  reminder: string;
}

export interface LearningInsightProfile {
  lookbackDays: number;
  totalTrades: number;
  analyzedTrades: number;
  verdicts: Record<CoachVerdict, number>;
  leaks: LearningPattern[];
  strengths: LearningPattern[];
  intention: string;
  recentMistakeNotes: string[];
}

function countTag(reports: TradingCoachTradeReport[], tag: string): number {
  return reports.filter((r) => r.analysis.tags.includes(tag)).length;
}

function countDiscretionaryLosses(reports: TradingCoachTradeReport[]): number {
  return reports.filter(
    (r) =>
      r.analysis.tags.includes('discretionary') &&
      r.analysis.tags.includes('loser'),
  ).length;
}

function buildLearningProfile(
  reports: TradingCoachTradeReport[],
  lookbackDays: number,
): LearningInsightProfile {
  const verdicts: Record<CoachVerdict, number> = {
    good: 0,
    bad: 0,
    ugly: 0,
  };

  for (const report of reports) {
    verdicts[report.analysis.verdict] += 1;
  }

  const leaks: LearningPattern[] = [];
  const strengths: LearningPattern[] = [];

  const ugly = verdicts.ugly;
  if (ugly > 0) {
    leaks.push({
      label: 'Ugly trades (no system edge)',
      count: ugly,
      reminder:
        'Conviction or direction below your bar? Walk away. Revenge trades live here.',
    });
  }

  const discLoss = countDiscretionaryLosses(reports);
  if (discLoss > 0) {
    leaks.push({
      label: 'Discretionary losses',
      count: discLoss,
      reminder:
        'You paid tuition on trades the engine never blessed — wait for the green light.',
    });
  }

  const chased = countTag(reports, 'chased_entry');
  if (chased > 0) {
    leaks.push({
      label: 'Chased entries',
      count: chased,
      reminder:
        'You jumped after the move started — let the next A+ setup come to you.',
    });
  }

  const vetoed = countTag(reports, 'vetoed_entry');
  if (vetoed > 0) {
    leaks.push({
      label: 'Entries against veto / NO-TRADE',
      count: vetoed,
      reminder:
        'Engine screamed NO-TRADE or decay veto — that’s a hard stop, not a hint.',
    });
  }

  const earlyExit = reports.filter(
    (r) =>
      r.analysis.tags.includes('early_exit') &&
      r.analysis.tags.includes('winner'),
  ).length;
  if (earlyExit > 0) {
    leaks.push({
      label: 'Early exits on winners',
      count: earlyExit,
      reminder:
        'You left early while spot kept paying — partials + trail rules are your friend.',
    });
  }

  const lucky = countTag(reports, 'lucky_override');
  if (lucky > 0) {
    leaks.push({
      label: 'Lucky discretionary wins',
      count: lucky,
      reminder:
        'Green PnL without engine approval — don’t let luck loosen your filters.',
    });
  }

  const approvedWins = reports.filter(
    (r) =>
      r.analysis.systemApproved &&
      r.analysis.tags.includes('winner'),
  ).length;
  if (approvedWins > 0) {
    strengths.push({
      label: 'System-approved wins',
      count: approvedWins,
      reminder: 'This is the recipe — valid setup, sized risk, trust the plan.',
    });
  }

  const cleanEntries = countTag(reports, 'clean_entry');
  if (cleanEntries > 0) {
    strengths.push({
      label: 'Clean entries',
      count: cleanEntries,
      reminder:
        'Direction, conviction, and structure all lined up — keep the prep that makes this happen.',
    });
  }

  const goodExits = countTag(reports, 'good_exit');
  if (goodExits > 0) {
    strengths.push({
      label: 'Strong exit timing',
      count: goodExits,
      reminder:
        'Exits matched the move — guard this discipline even on red days.',
    });
  }

  leaks.sort((a, b) => b.count - a.count);
  strengths.sort((a, b) => b.count - a.count);

  const topLeak = leaks[0];
  const intention = topLeak
    ? `Today’s mantra: ${topLeak.reminder}`
    : reports.length > 0
      ? 'Today’s mantra: only engine-approved setups at your conviction bar — one A+ trade beats five “meh” ones.'
      : 'Today’s mantra: fresh slate — run your checklist and make the first setup A-grade.';

  const recentMistakeNotes = reports
    .filter((r) => r.analysis.verdict === 'ugly' || r.analysis.verdict === 'bad')
    .slice(0, 4)
    .map((r) => r.analysis.coaching[0])
    .filter(Boolean);

  return {
    lookbackDays,
    totalTrades: reports.length,
    analyzedTrades: reports.length,
    verdicts,
    leaks: leaks.slice(0, 4),
    strengths: strengths.slice(0, 3),
    intention,
    recentMistakeNotes,
  };
}

export async function collectLearningTradeReports(
  fastify: FastifyInstance,
  params: {
    watchedSymbols: string[];
    watchedStyles: TradingStyle[];
    lookbackDays: number;
  },
): Promise<TradingCoachTradeReport[]> {
  const styles = watchedStylesForCoach(params.watchedStyles);
  const indexFilter =
    params.watchedSymbols.length === 1 ? params.watchedSymbols[0] : undefined;
  const dateRange = resolveCoachDateRange({ days: params.lookbackDays });

  const reports: TradingCoachTradeReport[] = [];
  for (const tradingStyle of styles) {
    try {
      const coach = await runTradingCoachAnalysis(fastify, {
        tradingStyle,
        indexFilter,
        dateRange,
      });
      reports.push(...coach.trades);
    } catch {
      // Skip style on API failure — learning still works from other styles
    }
  }

  return reports.sort(
    (a, b) => b.trade.exitAtMs - a.trade.exitAtMs,
  );
}

export function resolveLearningLookbackDays(text?: string): number {
  const envRaw = process.env.TELEGRAM_LEARNING_LOOKBACK_DAYS?.trim();
  const envDays = envRaw ? Number(envRaw) : NaN;
  const defaultDays =
    Number.isFinite(envDays) && envDays > 0
      ? Math.min(30, Math.floor(envDays))
      : 10;

  if (!text) return defaultDays;
  const parts = text.split(/\s+/).filter(Boolean);
  for (const part of parts.slice(1)) {
    if (/^\d+$/.test(part)) {
      const n = Number(part);
      if (n > 0) return Math.min(30, Math.floor(n));
    }
  }
  return defaultDays;
}

export async function buildLearningInsightProfile(
  fastify: FastifyInstance,
  params: {
    watchedSymbols: string[];
    watchedStyles: TradingStyle[];
    lookbackDays?: number;
    commandText?: string;
  },
): Promise<LearningInsightProfile> {
  const lookbackDays = resolveLearningLookbackDays(
    params.commandText ??
      String(params.lookbackDays ?? TELEGRAM_NOTIFICATION_DEFAULTS.LEARNING_LOOKBACK_DAYS),
  );

  const reports = await collectLearningTradeReports(fastify, {
    watchedSymbols: params.watchedSymbols,
    watchedStyles: params.watchedStyles,
    lookbackDays,
  });

  return buildLearningProfile(reports, lookbackDays);
}