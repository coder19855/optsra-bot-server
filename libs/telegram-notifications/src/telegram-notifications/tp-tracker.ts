import { FastifyInstance } from 'fastify';
import { TELEGRAM_NOTIFICATION_DEFAULTS } from '../constants/telegram-notifications';
import {
  PositionTpEvaluation,
  TpAlertKind,
  TpMonitorSnapshot,
  TpTrackReason,
} from '../types/telegram-notifications';
export function tpSnapshotKey(positionSymbol: string): string {
  return `tp:${positionSymbol}`;
}

export async function loadTpSnapshot(
  fastify: FastifyInstance,
  memory: Map<string, TpMonitorSnapshot>,
  positionSymbol: string,
): Promise<TpMonitorSnapshot | null> {
  const key = tpSnapshotKey(positionSymbol);
  const col = fastify.mongo?.db?.collection<TpMonitorSnapshot>(
    TELEGRAM_NOTIFICATION_DEFAULTS.TP_SNAPSHOT_COLLECTION,
  );
  if (col) {
    const doc = await col.findOne({ key });
    if (doc) return doc;
  }
  return memory.get(key) ?? null;
}

export async function saveTpSnapshot(
  fastify: FastifyInstance,
  memory: Map<string, TpMonitorSnapshot>,
  snapshot: TpMonitorSnapshot,
): Promise<void> {
  memory.set(snapshot.key, snapshot);
  const col = fastify.mongo?.db?.collection<TpMonitorSnapshot>(
    TELEGRAM_NOTIFICATION_DEFAULTS.TP_SNAPSHOT_COLLECTION,
  );
  if (!col) return;
  await col.updateOne(
    { key: snapshot.key },
    { $set: snapshot },
    { upsert: true },
  );
}

export function detectTpAlertChange(
  previous: TpMonitorSnapshot | null,
  evaluation: PositionTpEvaluation,
  options?: { isTracked: boolean },
): { shouldNotify: boolean; kinds: TpAlertKind[] } {
  if (!options?.isTracked) {
    return { shouldNotify: false, kinds: [] };
  }
  const kinds: TpAlertKind[] = [];
  const hitRr = evaluation.highestHitTp?.rr ?? null;
  const nextRr = evaluation.nextTp?.rr ?? null;

  if (hitRr && hitRr !== (previous?.highestTpRr ?? null)) {
    kinds.push('REACHED');
  }

  if (
    evaluation.alertKind === 'APPROACHING' &&
    nextRr &&
    nextRr !== (previous?.approachingTpRr ?? null)
  ) {
    kinds.push('APPROACHING');
  }

  if (
    evaluation.alertKind === 'SIGNAL_CONFLICT' &&
    previous?.lastAlertKind !== 'SIGNAL_CONFLICT'
  ) {
    kinds.push('SIGNAL_CONFLICT');
  }

  if (
    evaluation.alertKind === 'HOLD_REVIEW' &&
    hitRr &&
    evaluation.holdAdvice !== (previous?.lastHoldAdvice ?? null) &&
    (evaluation.holdAdvice === 'exit' || evaluation.holdAdvice === 'partial')
  ) {
    kinds.push('HOLD_REVIEW');
  }

  const shouldNotify = kinds.length > 0;
  return { shouldNotify, kinds };
}

export function buildTpMonitorSnapshot(
  evaluation: PositionTpEvaluation,
  previous: TpMonitorSnapshot | null,
  notified: boolean,
  tracking: { isTracked: boolean; trackReason: TpTrackReason },
): TpMonitorSnapshot {
  const now = new Date();
  const hitRr = evaluation.highestHitTp?.rr ?? null;
  const newlyTracked = tracking.isTracked && !previous?.isTracked;
  return {
    key: tpSnapshotKey(evaluation.position.symbol),
    positionSymbol: evaluation.position.symbol,
    isTracked: tracking.isTracked,
    trackReason: tracking.trackReason,
    trackedAt: newlyTracked ? now : previous?.trackedAt,
    highestTpRr: hitRr ?? previous?.highestTpRr ?? null,
    approachingTpRr:
      evaluation.alertKind === 'APPROACHING'
        ? evaluation.nextTp?.rr ?? null
        : hitRr && hitRr !== (previous?.highestTpRr ?? null)
          ? null
          : previous?.approachingTpRr ?? null,
    lastHoldAdvice: evaluation.holdAdvice,
    lastAlertKind: evaluation.alertKind,
    updatedAt: now,
    lastNotifiedAt: notified ? now : previous?.lastNotifiedAt,
    lastPositionHealthScore: evaluation.managementAdvice?.positionHealth?.score ?? previous?.lastPositionHealthScore,
  };
}

export function buildUntrackedTpSnapshot(
  positionSymbol: string,
  previous: TpMonitorSnapshot | null,
): TpMonitorSnapshot {
  const now = new Date();
  return {
    key: tpSnapshotKey(positionSymbol),
    positionSymbol,
    isTracked: false,
    trackReason: null,
    highestTpRr: previous?.highestTpRr ?? null,
    approachingTpRr: null,
    lastHoldAdvice: null,
    lastAlertKind: null,
    updatedAt: now,
    trackedAt: previous?.trackedAt,
    lastNotifiedAt: previous?.lastNotifiedAt,
  };
}

export async function deleteTpSnapshot(
  fastify: FastifyInstance,
  memory: Map<string, TpMonitorSnapshot>,
  positionSymbol: string,
): Promise<void> {
  const key = tpSnapshotKey(positionSymbol);
  memory.delete(key);
  const col = fastify.mongo?.db?.collection<TpMonitorSnapshot>(
    TELEGRAM_NOTIFICATION_DEFAULTS.TP_SNAPSHOT_COLLECTION,
  );
  if (!col) return;
  await col.deleteOne({ key });
}

