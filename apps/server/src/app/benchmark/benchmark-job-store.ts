import crypto from 'crypto';
import { FastifyInstance } from 'fastify';
import { BenchmarkParams } from './types';

const COLLECTION = 'benchmark-jobs';

export type BenchmarkJobPhase =
  | 'queued'
  | 'fetching'
  | 'replaying'
  | 'simulating'
  | 'ai'
  | 'finalizing'
  | 'complete'
  | 'failed';

export const BENCHMARK_JOB_TTL_MS = 6 * 60 * 60 * 1000;

export type BenchmarkJobStatus = 'queued' | 'running' | 'complete' | 'failed';

export interface BenchmarkJobProgress {
  phase: BenchmarkJobPhase;
  percent: number;
  message: string;
  currentDay?: number;
  totalDays?: number;
  anchorsDone?: number;
  anchorsTotal?: number;
}

export interface BenchmarkJobRecord {
  jobId: string;
  status: BenchmarkJobStatus;
  progress: BenchmarkJobProgress;
  params: BenchmarkParams & { days: number };
  reportId?: string;
  error?: string;
  notifyChatId?: number;
  createdAt: string;
  updatedAt: string;
  expiresAt: number;
}

const memory = new Map<string, BenchmarkJobRecord>();

export function createBenchmarkJobId(): string {
  return crypto.randomBytes(12).toString('hex');
}

function purgeExpiredMemory(): void {
  const now = Date.now();
  for (const [id, job] of memory.entries()) {
    if (job.expiresAt <= now) memory.delete(id);
  }
}

export async function saveBenchmarkJob(
  fastify: FastifyInstance,
  job: BenchmarkJobRecord,
): Promise<void> {
  purgeExpiredMemory();
  memory.set(job.jobId, job);

  const col = fastify.mongo?.db?.collection(COLLECTION);
  if (!col) return;

  await col.updateOne(
    { jobId: job.jobId },
    { $set: job },
    { upsert: true },
  );
}

export async function loadBenchmarkJob(
  fastify: FastifyInstance,
  jobId: string,
): Promise<BenchmarkJobRecord | null> {
  purgeExpiredMemory();
  const trimmed = jobId.trim();
  if (!trimmed) return null;

  const cached = memory.get(trimmed);
  if (cached) {
    if (cached.expiresAt <= Date.now()) {
      memory.delete(trimmed);
      return null;
    }
    return cached;
  }

  const col = fastify.mongo?.db?.collection<BenchmarkJobRecord>(COLLECTION);
  if (!col) return null;

  const doc = await col.findOne({ jobId: trimmed });
  if (!doc) return null;

  const expiresAt = Number(doc.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    return null;
  }

  memory.set(trimmed, doc);
  return doc;
}

export async function patchBenchmarkJob(
  fastify: FastifyInstance,
  jobId: string,
  patch: Partial<
    Pick<
      BenchmarkJobRecord,
      'status' | 'progress' | 'reportId' | 'error' | 'updatedAt'
    >
  >,
): Promise<BenchmarkJobRecord | null> {
  const existing = await loadBenchmarkJob(fastify, jobId);
  if (!existing) return null;

  const next: BenchmarkJobRecord = {
    ...existing,
    ...patch,
    progress: patch.progress ?? existing.progress,
    updatedAt: patch.updatedAt ?? new Date().toISOString(),
  };

  await saveBenchmarkJob(fastify, next);
  return next;
}

export function buildProgressUpdate(
  partial: Omit<BenchmarkJobProgress, 'percent'> & { percent?: number },
): BenchmarkJobProgress {
  return {
    phase: partial.phase,
    percent: Math.min(100, Math.max(0, Math.round(partial.percent ?? 0))),
    message: partial.message,
    currentDay: partial.currentDay,
    totalDays: partial.totalDays,
    anchorsDone: partial.anchorsDone,
    anchorsTotal: partial.anchorsTotal,
  };
}

export function serializeBenchmarkJobStatus(job: BenchmarkJobRecord) {
  return {
    jobId: job.jobId,
    status: job.status,
    progress: job.progress,
    reportId: job.reportId ?? null,
    error: job.error ?? null,
    params: {
      symbol: job.params.symbol,
      tradingStyle: job.params.tradingStyle,
      days: job.params.days,
      aiMode: job.params.aiMode ?? 'shadow',
      maxTradesPerDay: job.params.maxTradesPerDay ?? null,
      vetoMode: job.params.vetoMode ?? 'strict',
      flowMode: job.params.flowMode ?? 'blend',
    },
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}