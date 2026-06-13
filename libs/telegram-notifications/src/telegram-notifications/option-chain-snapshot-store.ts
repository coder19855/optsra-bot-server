import { FastifyInstance } from 'fastify';
import {
  OPTION_CHAIN_SNAPSHOT_DEFAULTS,
  resolveOptionChainFlushIntervalMs,
  resolveOptionChainRetentionDays,
} from '../constants/option-chain-snapshots';
import {
  OptionChainSnapshotInput,
  OptionChainSnapshotRecord,
} from '../types/option-chain-snapshot';
import { TradingStyle } from '../types/trading-style';

function snapshotKey(symbol: string, tradingStyle: TradingStyle): string {
  return `${symbol}:${tradingStyle}`;
}

export function floorToBucketMs(ms: number, intervalMs: number): number {
  return Math.floor(ms / intervalMs) * intervalMs;
}

interface PendingSnapshot extends OptionChainSnapshotInput {
  bucketMs: number;
  capturedAtMs: number;
}

const pendingByKey = new Map<string, PendingSnapshot>();
let flushTimer: NodeJS.Timeout | null = null;
let indexesEnsured = false;

function getCollection(fastify: FastifyInstance) {
  return fastify.mongo?.db?.collection<OptionChainSnapshotRecord>(
    OPTION_CHAIN_SNAPSHOT_DEFAULTS.COLLECTION,
  );
}

function retentionExpiresAt(
  bucketMs: number,
  retentionDays = resolveOptionChainRetentionDays(),
): Date {
  return new Date(bucketMs + retentionDays * 24 * 60 * 60 * 1000);
}

function toPersistedRecord(
  pending: PendingSnapshot,
  retentionDays = resolveOptionChainRetentionDays(),
): OptionChainSnapshotRecord {
  return {
    symbol: pending.symbol,
    tradingStyle: pending.tradingStyle,
    bucketAt: new Date(pending.bucketMs),
    capturedAt: new Date(pending.capturedAtMs),
    spotLtp: pending.spotLtp,
    overallScore: pending.overallScore,
    bias: pending.bias,
    optionConviction: pending.optionConviction,
    components: pending.components,
    expiresAt: retentionExpiresAt(pending.bucketMs, retentionDays),
  };
}

export async function ensureOptionChainSnapshotIndexes(
  fastify: FastifyInstance,
): Promise<void> {
  if (indexesEnsured) return;
  const col = getCollection(fastify);
  if (!col) return;

  await col.createIndex(
    { symbol: 1, tradingStyle: 1, bucketAt: -1 },
    { name: 'symbol_style_bucket' },
  );
  await col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'ttl_expires_at' });
  indexesEnsured = true;
}

/** Buffer the latest option-chain read in memory (cheap; no Mongo write yet). */
export function recordOptionChainSnapshot(
  _fastify: FastifyInstance,
  input: OptionChainSnapshotInput,
  nowMs = Date.now(),
): void {
  const intervalMs = resolveOptionChainFlushIntervalMs();
  const bucketMs = floorToBucketMs(nowMs, intervalMs);
  const key = snapshotKey(input.symbol, input.tradingStyle);
  pendingByKey.set(key, {
    ...input,
    bucketMs,
    capturedAtMs: nowMs,
  });
}

export async function flushOptionChainSnapshots(
  fastify: FastifyInstance,
  nowMs = Date.now(),
): Promise<number> {
  const col = getCollection(fastify);
  if (!col || pendingByKey.size === 0) return 0;

  await ensureOptionChainSnapshotIndexes(fastify);

  const intervalMs = resolveOptionChainFlushIntervalMs();
  const currentBucketMs = floorToBucketMs(nowMs, intervalMs);
  let flushed = 0;

  for (const [key, pending] of pendingByKey.entries()) {
    if (pending.bucketMs >= currentBucketMs) continue;

    const record = toPersistedRecord(pending);
    await col.updateOne(
      {
        symbol: record.symbol,
        tradingStyle: record.tradingStyle,
        bucketAt: record.bucketAt,
      },
      { $set: record },
      { upsert: true },
    );
    pendingByKey.delete(key);
    flushed += 1;
  }

  if (flushed > 0) {
    fastify.log.debug(
      { flushed, pending: pendingByKey.size },
      'Option chain snapshots flushed to MongoDB',
    );
  }

  return flushed;
}

/** Force-flush in-flight buckets (e.g. graceful shutdown). */
export async function flushAllPendingOptionChainSnapshots(
  fastify: FastifyInstance,
): Promise<number> {
  const col = getCollection(fastify);
  if (!col || pendingByKey.size === 0) return 0;

  await ensureOptionChainSnapshotIndexes(fastify);

  let flushed = 0;
  for (const pending of pendingByKey.values()) {
    const record = toPersistedRecord(pending);
    await col.updateOne(
      {
        symbol: record.symbol,
        tradingStyle: record.tradingStyle,
        bucketAt: record.bucketAt,
      },
      { $set: record },
      { upsert: true },
    );
    flushed += 1;
  }
  pendingByKey.clear();
  return flushed;
}

export async function purgeOptionChainSnapshotsOlderThan(
  fastify: FastifyInstance,
  days = resolveOptionChainRetentionDays(),
  nowMs = Date.now(),
): Promise<number> {
  const col = getCollection(fastify);
  if (!col) return 0;

  const cutoff = new Date(nowMs - days * 24 * 60 * 60 * 1000);
  const result = await col.deleteMany({ bucketAt: { $lt: cutoff } });
  const deleted = result.deletedCount ?? 0;

  if (deleted > 0) {
    fastify.log.info(
      { deleted, cutoff: cutoff.toISOString(), retentionDays: days },
      'Purged old option chain snapshots',
    );
  }

  return deleted;
}

export async function loadOptionChainSnapshotsForSession(
  fastify: FastifyInstance,
  symbol: string,
  tradingStyle: TradingStyle,
  sessionDate: string,
): Promise<OptionChainSnapshotRecord[]> {
  const col = getCollection(fastify);
  if (!col) return [];

  const startMs = Date.parse(`${sessionDate}T09:15:00+05:30`);
  const endMs = Date.parse(`${sessionDate}T15:30:00+05:30`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return [];

  const docs = await col
    .find({
      symbol,
      tradingStyle,
      bucketAt: { $gte: new Date(startMs), $lte: new Date(endMs) },
    })
    .sort({ bucketAt: 1 })
    .toArray();

  return docs.map((doc) => ({
    ...doc,
    bucketAt: doc.bucketAt instanceof Date ? doc.bucketAt : new Date(doc.bucketAt),
    capturedAt:
      doc.capturedAt instanceof Date ? doc.capturedAt : new Date(doc.capturedAt),
    expiresAt:
      doc.expiresAt instanceof Date ? doc.expiresAt : new Date(doc.expiresAt),
  }));
}

export function nearestOptionChainSnapshot(
  snapshots: OptionChainSnapshotRecord[],
  asOfMs: number,
): OptionChainSnapshotRecord | null {
  if (!snapshots.length) return null;

  let best = snapshots[0];
  let bestDist = Math.abs(best.bucketAt.getTime() - asOfMs);
  for (let i = 1; i < snapshots.length; i += 1) {
    const snap = snapshots[i];
    const dist = Math.abs(snap.bucketAt.getTime() - asOfMs);
    if (dist < bestDist) {
      best = snap;
      bestDist = dist;
    }
  }
  return best;
}

/**
 * Rough weekly footprint for capacity planning (compact component scores only).
 * Example: 1 symbol × 3 styles × 75 buckets/day × 7 days ≈ 1.5k docs ≈ 2–4 MB.
 */
export function estimateOptionChainSnapshotFootprint(input: {
  symbols: number;
  tradingStyles: number;
  marketMinutesPerDay?: number;
  intervalMinutes?: number;
  retentionDays?: number;
  bytesPerDoc?: number;
}): {
  docsPerDay: number;
  docsRetained: number;
  estimatedBytes: number;
  estimatedMegabytes: number;
} {
  const marketMinutes = input.marketMinutesPerDay ?? 375;
  const intervalMinutes =
    input.intervalMinutes ??
    resolveOptionChainFlushIntervalMs() / (60 * 1000);
  const retentionDays = input.retentionDays ?? resolveOptionChainRetentionDays();
  const bytesPerDoc = input.bytesPerDoc ?? 1400;

  const bucketsPerDay = Math.ceil(marketMinutes / intervalMinutes);
  const docsPerDay = input.symbols * input.tradingStyles * bucketsPerDay;
  const docsRetained = docsPerDay * retentionDays;
  const estimatedBytes = docsRetained * bytesPerDoc;

  return {
    docsPerDay,
    docsRetained,
    estimatedBytes,
    estimatedMegabytes: +(estimatedBytes / (1024 * 1024)).toFixed(2),
  };
}

export function startOptionChainSnapshotScheduler(fastify: FastifyInstance): void {
  if (flushTimer) return;

  const intervalMs = resolveOptionChainFlushIntervalMs();

  void ensureOptionChainSnapshotIndexes(fastify).catch((err) => {
    fastify.log.warn({ err }, 'Option chain snapshot index setup failed');
  });

  flushTimer = setInterval(() => {
    void flushOptionChainSnapshots(fastify)
      .then(() => purgeOptionChainSnapshotsOlderThan(fastify))
      .catch((err) => {
        fastify.log.warn({ err }, 'Option chain snapshot flush/purge failed');
      });
  }, intervalMs);

  fastify.log.info(
    {
      intervalMs,
      retentionDays: resolveOptionChainRetentionDays(),
      footprint: estimateOptionChainSnapshotFootprint({
        symbols: 1,
        tradingStyles: 3,
      }),
    },
    'Option chain snapshot scheduler started',
  );

  fastify.addHook('onClose', async () => {
    if (flushTimer) {
      clearInterval(flushTimer);
      flushTimer = null;
    }
    await flushAllPendingOptionChainSnapshots(fastify);
  });
}

/** Test-only reset */
export function resetOptionChainSnapshotStoreForTests(): void {
  pendingByKey.clear();
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  indexesEnsured = false;
}