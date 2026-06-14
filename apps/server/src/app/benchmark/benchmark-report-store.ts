import crypto from 'crypto';
import { FastifyInstance } from 'fastify';
import {
  serializeBenchmarkReport,
  SerializedBenchmarkReport,
} from './benchmark-serialize';
import { BenchmarkReport } from './types';

const COLLECTION = 'benchmark-reports';
const TTL_MS = 48 * 60 * 60 * 1000;

const memory = new Map<
  string,
  { report: SerializedBenchmarkReport; expiresAt: number }
>();

export function createBenchmarkReportId(): string {
  return crypto.randomBytes(16).toString('hex');
}

function purgeExpiredMemory(): void {
  const now = Date.now();
  for (const [id, entry] of memory.entries()) {
    if (entry.expiresAt <= now) memory.delete(id);
  }
}

export async function saveBenchmarkReport(
  fastify: FastifyInstance,
  id: string,
  report: BenchmarkReport,
): Promise<void> {
  purgeExpiredMemory();
  const serialized = serializeBenchmarkReport(report);
  const expiresAt = Date.now() + TTL_MS;
  memory.set(id, { report: serialized, expiresAt });

  const col = fastify.mongo?.db?.collection<{
    _id: string;
    report: SerializedBenchmarkReport;
    expiresAt: Date;
    createdAt: Date;
  }>(COLLECTION);
  if (!col) return;

  await col.updateOne(
    { _id: id },
    {
      $set: {
        report: serialized,
        expiresAt: new Date(expiresAt),
        createdAt: new Date(),
      },
    },
    { upsert: true },
  );
}

export async function loadBenchmarkReport(
  fastify: FastifyInstance,
  id: string,
): Promise<SerializedBenchmarkReport | null> {
  purgeExpiredMemory();
  const trimmed = id.trim();
  if (!trimmed) return null;

  const cached = memory.get(trimmed);
  if (cached) {
    if (cached.expiresAt <= Date.now()) {
      memory.delete(trimmed);
      return null;
    }
    return cached.report;
  }

  const col = fastify.mongo?.db?.collection<{
    _id: string;
    report: SerializedBenchmarkReport;
    expiresAt: Date;
  }>(COLLECTION);
  if (!col) return null;

  const doc = await col.findOne({ _id: trimmed });
  if (!doc?.report) return null;

  const expiresAt =
    doc.expiresAt instanceof Date
      ? doc.expiresAt.getTime()
      : new Date(doc.expiresAt).getTime();
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    return null;
  }

  memory.set(trimmed, { report: doc.report, expiresAt });
  return doc.report;
}