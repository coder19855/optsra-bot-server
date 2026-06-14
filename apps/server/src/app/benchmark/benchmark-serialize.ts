import { BenchmarkReport } from './types';

/** API-safe benchmark payload (smaller trade rows, no nested setup blobs). */
export function serializeBenchmarkReport(report: BenchmarkReport) {
  return {
    ...report,
    trades: report.trades.map((t) => ({
      signalAtMs: t.signalAtMs,
      signalAtISO: t.signalAtISO,
      sessionDate: t.sessionDate,
      action: t.action,
      indexEntry: t.indexEntry,
      indexExit: t.indexExit,
      stopLoss: t.stopLoss,
      takeProfit1: t.takeProfit1,
      takeProfit2: t.takeProfit2,
      takeProfit3: t.takeProfit3,
      exitStatus: t.exitStatus,
      hitLevel: t.hitLevel,
      pnlPoints: t.pnlPoints,
      pnlR: t.pnlR,
      pnlPercent: t.pnlPercent,
      barsHeld: t.barsHeld,
      conviction: t.conviction,
      convictionWithAi: t.convictionWithAi,
      pnlInr: t.pnlInr,
      riskBudgetInr: t.riskBudgetInr,
      optionSource: t.optionSource,
      engineVerdict: t.engineVerdict,
      aiVerdictSummary: t.aiVerdictSummary,
      aiAnalysis: t.aiAnalysis
        ? {
            verdict: t.aiAnalysis.verdict,
            confidenceAdjustment: t.aiAnalysis.confidenceAdjustment,
            betaNote: t.aiAnalysis.betaNote,
          }
        : undefined,
      isWin:
        t.exitStatus === 'TAKE_PROFIT' ||
        (t.pnlR > 0.05 && t.exitStatus !== 'STOP_LOSS'),
    })),
  };
}

export type SerializedBenchmarkReport = ReturnType<
  typeof serializeBenchmarkReport
>;