import { FastifyInstance } from 'fastify';
import { toErrorMessage } from '../error-message';
import {
  createBenchmarkJobId,
  loadBenchmarkJob,
  patchBenchmarkJob,
  saveBenchmarkJob,
  BENCHMARK_JOB_TTL_MS,
  BenchmarkJobRecord,
} from './benchmark-job-store';
import {
  createBenchmarkReportId,
  saveBenchmarkReport,
} from './benchmark-report-store';
import { runBenchmark } from './run-benchmark';
import { BenchmarkParams, BenchmarkProgressCallback } from './types';

export interface StartBenchmarkJobInput extends BenchmarkParams {
  days: number;
  notifyChatId?: number;
}

export async function createBenchmarkJob(
  fastify: FastifyInstance,
  input: StartBenchmarkJobInput,
): Promise<BenchmarkJobRecord> {
  const now = new Date().toISOString();
  const job: BenchmarkJobRecord = {
    jobId: createBenchmarkJobId(),
    status: 'queued',
    progress: {
      phase: 'queued',
      percent: 0,
      message: 'Queued — starting soon…',
      totalDays: input.days,
    },
    params: {
      ...input,
      days: input.days,
    },
    notifyChatId: input.notifyChatId,
    createdAt: now,
    updatedAt: now,
    expiresAt: Date.now() + BENCHMARK_JOB_TTL_MS,
  };
  await saveBenchmarkJob(fastify, job);
  return job;
}

export function enqueueBenchmarkJob(
  fastify: FastifyInstance,
  jobId: string,
  onSettled?: (job: BenchmarkJobRecord | null) => void | Promise<void>,
): void {
  void runBenchmarkJob(fastify, jobId)
    .then((job) => onSettled?.(job ?? null))
    .catch((err) => {
      fastify.log.warn({ err, jobId }, 'benchmark job runner failed');
      return onSettled?.(null);
    });
}

export async function runBenchmarkJob(
  fastify: FastifyInstance,
  jobId: string,
): Promise<BenchmarkJobRecord | null> {
  const job = await loadBenchmarkJob(fastify, jobId);
  if (!job) return null;
  if (job.status === 'complete' || job.status === 'failed') {
    return job;
  }

  await patchBenchmarkJob(fastify, jobId, {
    status: 'running',
    progress: {
      phase: 'fetching',
      percent: 2,
      message: 'Fetching candle history…',
      totalDays: job.params.days,
    },
  });

  const onProgress: BenchmarkProgressCallback = async (progress) => {
    await patchBenchmarkJob(fastify, jobId, { progress });
  };

  try {
    const report = await runBenchmark(fastify, {
      ...job.params,
      onProgress,
    });

    await patchBenchmarkJob(fastify, jobId, {
      progress: {
        phase: 'finalizing',
        percent: 96,
        message: 'Building report…',
        totalDays: job.params.days,
        currentDay: job.params.days,
      },
    });

    const reportId = createBenchmarkReportId();
    await saveBenchmarkReport(fastify, reportId, report);

    return (
      (await patchBenchmarkJob(fastify, jobId, {
        status: 'complete',
        reportId,
        progress: {
          phase: 'complete',
          percent: 100,
          message: 'Complete',
          totalDays: job.params.days,
          currentDay: job.params.days,
        },
      })) ?? null
    );
  } catch (err) {
    const message = toErrorMessage(err);
    return (
      (await patchBenchmarkJob(fastify, jobId, {
        status: 'failed',
        error: message,
        progress: {
          phase: 'failed',
          percent: 100,
          message,
          totalDays: job.params.days,
        },
      })) ?? null
    );
  }
}

