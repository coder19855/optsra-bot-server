import {
  BenchmarkAiComparison,
  BenchmarkTradeRow,
  BenchmarkVariantSummary,
} from './types';
import { isBenchmarkLoss, isBenchmarkWin } from './trailing-tp-simulator';

export function summarizeTrades(
  label: string,
  trades: BenchmarkTradeRow[],
): BenchmarkVariantSummary {
  let wins = 0;
  let losses = 0;
  let flats = 0;
  let totalPnlR = 0;
  let totalPnlPct = 0;
  const takeProfitCounts: Record<'1:1.5' | '1:2.5' | '1:4', number> = {
    '1:1.5': 0,
    '1:2.5': 0,
    '1:4': 0,
  };
  let stopLossCount = 0;
  let sessionEndCount = 0;
  let signalFlipCount = 0;
  let trailFloorCount = 0;

  for (const t of trades) {
    totalPnlR += t.pnlR;
    totalPnlPct += t.pnlPercent;
    if (isBenchmarkWin(t.exitStatus, t.pnlR)) wins += 1;
    else if (isBenchmarkLoss(t.exitStatus, t.pnlR)) losses += 1;
    else flats += 1;

    if (t.hitLevel === 'STOP_LOSS') stopLossCount += 1;
    else if (t.hitLevel === 'SESSION_END') sessionEndCount += 1;
    else if (t.hitLevel === 'SIGNAL_FLIP') signalFlipCount += 1;
    else if (t.hitLevel === 'TRAIL_FLOOR') trailFloorCount += 1;
    else if (
      t.hitLevel === '1:1.5' ||
      t.hitLevel === '1:2.5' ||
      t.hitLevel === '1:4'
    ) {
      takeProfitCounts[t.hitLevel] += 1;
    }
  }

  const decided = wins + losses;
  return {
    label,
    totalSignals: trades.length,
    wins,
    losses,
    flats,
    winRate: decided > 0 ? Math.round((wins / decided) * 1000) / 10 : 0,
    avgPnlR: trades.length ? +(totalPnlR / trades.length).toFixed(3) : 0,
    totalPnlR: +totalPnlR.toFixed(3),
    avgPnlPercent: trades.length ? +(totalPnlPct / trades.length).toFixed(2) : 0,
    stopLossCount,
    takeProfitCounts,
    sessionEndCount,
    signalFlipCount,
    trailFloorCount,
  };
}

export function buildAiComparison(
  baselineTrades: BenchmarkTradeRow[],
  activeTrades: BenchmarkTradeRow[] | null,
  aiMode: string,
  options?: { signalFlipExit?: boolean; maxTradesPerDay?: number },
): BenchmarkAiComparison {
  const baseline = summarizeTrades('Engine (no AI)', baselineTrades);
  const withAi =
    activeTrades != null
      ? summarizeTrades(
          aiMode === 'shadow' ? 'Engine + AI shadow' : 'Engine + AI active',
          activeTrades,
        )
      : null;

  let aiAgreeOnWins = 0;
  let aiAgreeOnLosses = 0;
  let aiDisagreeOnWins = 0;
  let aiDisagreeOnLosses = 0;

  for (const t of baselineTrades) {
    if (!t.aiAnalysis) continue;
    const win = isBenchmarkWin(t.exitStatus, t.pnlR);
    const loss = isBenchmarkLoss(t.exitStatus, t.pnlR);
    if (t.aiAnalysis.verdict === 'AGREE' && win) aiAgreeOnWins += 1;
    if (t.aiAnalysis.verdict === 'AGREE' && loss) aiAgreeOnLosses += 1;
    if (t.aiAnalysis.verdict === 'DISAGREE' && win) aiDisagreeOnWins += 1;
    if (t.aiAnalysis.verdict === 'DISAGREE' && loss) aiDisagreeOnLosses += 1;
  }

  const notes: string[] = [
    'Trailing TP: 1:1.5/1:2.5/1:4 locks; past 1:4 floor ratchets at peakR − 1R; flip/reversal/SL first.',
    'Signals use full decision engine with stored option snapshots when available.',
  ];
  if (options?.maxTradesPerDay != null) {
    notes.push(`Daily cap: ${options.maxTradesPerDay} entries per session day.`);
  } else {
    notes.push('Daily cap: unlimited entries per session day.');
  }
  if (options?.signalFlipExit !== false) {
    notes.push(
      'Flip exit: once 1:1.5+ is locked, 2 consecutive opposite polls exit at market (5m replay / 60s live).',
    );
  }
  if (aiMode === 'off') {
    notes.push('AI was off for this run — use aiMode=shadow or active to compare.');
  } else if (aiMode === 'shadow') {
    notes.push('AI shadow: opinions recorded; conviction math unchanged.');
  } else {
    notes.push('AI active: entries re-gated on AI-adjusted conviction.');
  }

  return {
    baseline,
    withAi,
    aiAgreeOnWins,
    aiAgreeOnLosses,
    aiDisagreeOnWins,
    aiDisagreeOnLosses,
    notes,
  };
}

export function buildEquityCurve(
  trades: BenchmarkTradeRow[],
): Array<{ t: number; cumulativeR: number; label: string }> {
  let cumulative = 0;
  return trades.map((t) => {
    cumulative += t.pnlR;
    return {
      t: t.signalAtMs,
      cumulativeR: +cumulative.toFixed(3),
      label: `${t.action} ${t.hitLevel}`,
    };
  });
}