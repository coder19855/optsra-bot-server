import { TradingStyle } from '../types/trading-style';
import { saveBenchmarkReport, loadBenchmarkReport } from './benchmark-report-store';
import { BenchmarkReport } from './types';

function minimalReport(): BenchmarkReport {
  return {
    params: {
      symbol: 'NSE:NIFTY50-INDEX',
      tradingStyle: TradingStyle.Intraday,
      days: 14,
      intervalMinutes: 15,
      enterThreshold: 60,
      aiMode: 'shadow',
    },
    simulationNote: 'test',
    optionFlowNote: 'test',
    stopLossNote: 'test',
    generatedAt: new Date().toISOString(),
    aiComparison: {
      baseline: {
        label: 'Engine',
        totalSignals: 0,
        wins: 0,
        losses: 0,
        flats: 0,
        winRate: 0,
        avgPnlR: 0,
        totalPnlR: 0,
        avgPnlPercent: 0,
        stopLossCount: 0,
        takeProfitCounts: { '1:1.5': 0, '1:2.5': 0, '1:4': 0 },
        sessionEndCount: 0,
        signalFlipCount: 0,
        trailFloorCount: 0,
      },
      withAi: null,
      aiAgreeOnWins: 0,
      aiAgreeOnLosses: 0,
      aiDisagreeOnWins: 0,
      aiDisagreeOnLosses: 0,
      notes: [],
    },
    trades: [],
    equityCurve: [],
    capitalSummary: {
      startingCapitalInr: 500_000,
      endingCapitalInr: 500_000,
      netPnlInr: 0,
      netPnlPercent: 0,
      riskPercentPerTrade: 1,
      compounding: true,
      maxDrawdownInr: 0,
      maxDrawdownPercent: 0,
      maxDrawdownR: 0,
      note: 'test',
    },
    capitalCurve: [],
  };
}

describe('benchmark report store', () => {
  const fastify = { mongo: undefined } as import('fastify').FastifyInstance;

  it('round-trips a report in memory', async () => {
    const id = 'test-report-id';
    await saveBenchmarkReport(fastify, id, minimalReport());
    const loaded = await loadBenchmarkReport(fastify, id);
    expect(loaded?.params.symbol).toBe('NSE:NIFTY50-INDEX');
    expect(loaded?.params.days).toBe(14);
  });

  it('returns null for unknown ids', async () => {
    await expect(loadBenchmarkReport(fastify, 'missing')).resolves.toBeNull();
  });
});