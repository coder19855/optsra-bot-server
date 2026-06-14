import { FastifyInstance } from 'fastify';
import { TradingStyle } from '../types/trading-style';
import {
  createBenchmarkJobId,
  loadBenchmarkJob,
  patchBenchmarkJob,
  saveBenchmarkJob,
  serializeBenchmarkJobStatus,
} from './benchmark-job-store';

describe('benchmark job store', () => {
  const fastify = { mongo: undefined } as FastifyInstance;

  it('creates unique job ids', () => {
    const a = createBenchmarkJobId();
    const b = createBenchmarkJobId();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(8);
  });

  it('saves, patches, and serializes job status', async () => {
    const jobId = createBenchmarkJobId();
    const now = new Date().toISOString();
    await saveBenchmarkJob(fastify, {
      jobId,
      status: 'queued',
      progress: {
        phase: 'queued',
        percent: 0,
        message: 'Queued',
        totalDays: 30,
      },
      params: {
        symbol: 'NSE:NIFTY50-INDEX',
        tradingStyle: TradingStyle.Intraday,
        days: 30,
        aiMode: 'shadow',
      },
      createdAt: now,
      updatedAt: now,
      expiresAt: Date.now() + 60_000,
    });

    let loaded = await loadBenchmarkJob(fastify, jobId);
    expect(loaded?.status).toBe('queued');

    await patchBenchmarkJob(fastify, jobId, {
      status: 'running',
      progress: {
        phase: 'replaying',
        percent: 42,
        message: 'Replaying signals · day 8/30',
        currentDay: 8,
        totalDays: 30,
      },
    });

    loaded = await loadBenchmarkJob(fastify, jobId);
    expect(loaded?.status).toBe('running');
    expect(loaded?.progress.percent).toBe(42);

    const serialized = serializeBenchmarkJobStatus(loaded!);
    expect(serialized.jobId).toBe(jobId);
    expect(serialized.progress.currentDay).toBe(8);
    expect(serialized.reportId).toBeNull();
  });
});