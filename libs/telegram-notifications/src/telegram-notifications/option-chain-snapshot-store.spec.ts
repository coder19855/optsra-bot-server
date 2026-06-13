import { FastifyInstance } from 'fastify';
import { OPTION_CHAIN_SNAPSHOT_DEFAULTS } from '../constants/option-chain-snapshots';
import { TradingStyle } from '../types/trading-style';
import {
  estimateOptionChainSnapshotFootprint,
  floorToBucketMs,
  flushOptionChainSnapshots,
  nearestOptionChainSnapshot,
  purgeOptionChainSnapshotsOlderThan,
  recordOptionChainSnapshot,
  resetOptionChainSnapshotStoreForTests,
} from './option-chain-snapshot-store';

function mockFastify(deleteManyResult = { deletedCount: 0 }) {
  const updateOne = jest.fn().mockResolvedValue({});
  const deleteMany = jest.fn().mockResolvedValue(deleteManyResult);
  const find = jest.fn().mockReturnValue({
    sort: jest.fn().mockReturnValue({
      toArray: jest.fn().mockResolvedValue([]),
    }),
  });
  const createIndex = jest.fn().mockResolvedValue('ok');

  const fastify = {
    log: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
    },
    mongo: {
      db: {
        collection: jest.fn().mockReturnValue({
          updateOne,
          deleteMany,
          find,
          createIndex,
        }),
      },
    },
    addHook: jest.fn(),
  } as unknown as FastifyInstance;

  return { fastify, updateOne, deleteMany };
}

describe('option-chain-snapshot-store', () => {
  beforeEach(() => {
    resetOptionChainSnapshotStoreForTests();
  });

  it('floors timestamps to bucket boundaries', () => {
    const interval = 5 * 60 * 1000;
    expect(floorToBucketMs(10 * 60 * 1000 + 30_000, interval)).toBe(
      10 * 60 * 1000,
    );
  });

  it('buffers in memory and flushes completed buckets', async () => {
    const intervalMs = 5 * 60 * 1000;
    const now = 12 * 60 * 1000;
    const { fastify, updateOne } = mockFastify();

    recordOptionChainSnapshot(
      fastify,
      {
        symbol: 'NSE:NIFTY50-INDEX',
        tradingStyle: TradingStyle.Intraday,
        spotLtp: 24_500,
        overallScore: 42,
        bias: 'Bullish',
        optionConviction: 55,
        components: [{ id: 'oi', name: 'OI', score: 0.4 }],
      },
      now,
    );

    const flushedEarly = await flushOptionChainSnapshots(
      fastify,
      now + intervalMs / 2,
    );
    expect(flushedEarly).toBe(0);
    expect(updateOne).not.toHaveBeenCalled();

    const flushed = await flushOptionChainSnapshots(
      fastify,
      now + intervalMs,
    );
    expect(flushed).toBe(1);
    expect(updateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: 'NSE:NIFTY50-INDEX',
        tradingStyle: TradingStyle.Intraday,
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          overallScore: 42,
          components: [{ id: 'oi', name: 'OI', score: 0.4 }],
        }),
      }),
      { upsert: true },
    );
  });

  it('purges snapshots older than retention window', async () => {
    const { fastify, deleteMany } = mockFastify({ deletedCount: 12 });
    const deleted = await purgeOptionChainSnapshotsOlderThan(fastify, 7, Date.now());
    expect(deleted).toBe(12);
    expect(deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        bucketAt: expect.objectContaining({ $lt: expect.any(Date) }),
      }),
    );
  });

  it('picks nearest snapshot for replay scrub', () => {
    const base = Date.parse('2026-06-10T10:00:00+05:30');
    const snapshots = [
      {
        symbol: 'NSE:NIFTY50-INDEX',
        tradingStyle: TradingStyle.Intraday,
        bucketAt: new Date(base),
        capturedAt: new Date(base),
        spotLtp: 24_500,
        overallScore: 10,
        bias: 'Neutral',
        optionConviction: 20,
        components: [],
        expiresAt: new Date(base + 7 * 86400000),
      },
      {
        symbol: 'NSE:NIFTY50-INDEX',
        tradingStyle: TradingStyle.Intraday,
        bucketAt: new Date(base + 5 * 60 * 1000),
        capturedAt: new Date(base + 5 * 60 * 1000),
        spotLtp: 24_510,
        overallScore: 30,
        bias: 'Bullish',
        optionConviction: 40,
        components: [],
        expiresAt: new Date(base + 7 * 86400000),
      },
    ];

    const nearest = nearestOptionChainSnapshot(
      snapshots,
      base + 2 * 60 * 1000,
    );
    expect(nearest?.overallScore).toBe(10);

    const nearestLater = nearestOptionChainSnapshot(
      snapshots,
      base + 6 * 60 * 1000,
    );
    expect(nearestLater?.overallScore).toBe(30);
  });

  it('estimates compact weekly storage in low megabytes', () => {
    const estimate = estimateOptionChainSnapshotFootprint({
      symbols: 2,
      tradingStyles: 3,
      marketMinutesPerDay: 375,
      intervalMinutes: 5,
      retentionDays: 7,
    });
    expect(estimate.docsPerDay).toBe(450);
    expect(estimate.docsRetained).toBe(3150);
    expect(estimate.estimatedMegabytes).toBeLessThan(10);
    expect(OPTION_CHAIN_SNAPSHOT_DEFAULTS.COLLECTION).toBe(
      'option-chain-snapshots',
    );
  });
});