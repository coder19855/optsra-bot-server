import { FyersAPI } from 'fyers-api-v3';
import {
  buildTradeSetup,
  isNseSession,
  parseEpochMs,
  simulateTradeOutcome,
  sliceCandlesAfter,
  sliceCandlesUpTo,
  toIso,
} from './timeline-utils';
import { sampleCandles } from '../testing/fixtures';

describe('timeline-utils', () => {
  describe('parseEpochMs', () => {
    it('converts seconds to milliseconds', () => {
      expect(parseEpochMs(1_700_000_000, 0)).toBe(1_700_000_000_000);
    });

    it('passes through millisecond epochs', () => {
      expect(parseEpochMs(1_700_000_000_000, 0)).toBe(1_700_000_000_000);
    });

    it('returns fallback for invalid values', () => {
      expect(parseEpochMs('bad', 99)).toBe(99);
      expect(parseEpochMs(-1, 42)).toBe(42);
    });
  });

  describe('toIso', () => {
    it('formats epoch to ISO string', () => {
      expect(toIso(0)).toBe('1970-01-01T00:00:00.000Z');
    });
  });

  describe('sliceCandlesUpTo', () => {
    it('returns empty for empty input', () => {
      expect(sliceCandlesUpTo([], 100)).toEqual([]);
    });

    it('binary-searches candles up to timestamp', () => {
      const candles = sampleCandles(10);
      const cutoff = candles[4][0];
      const sliced = sliceCandlesUpTo(candles, cutoff);
      expect(sliced).toHaveLength(5);
      expect(sliced.every((c) => c[0] <= cutoff)).toBe(true);
    });

    it('returns empty when all candles are after cutoff', () => {
      const candles: FyersAPI.Candle[] = [[100, 1, 2, 0.5, 1.5, 10]];
      expect(sliceCandlesUpTo(candles, 50)).toEqual([]);
    });
  });

  describe('isNseSession', () => {
    it('returns true during weekday market hours', () => {
      const marketOpenSec = Math.floor(
        new Date('2026-06-11T10:30:00+05:30').getTime() / 1000,
      );
      expect(isNseSession(marketOpenSec)).toBe(true);
    });

    it('returns false on weekends', () => {
      const saturdaySec = Math.floor(
        new Date('2026-06-13T10:30:00+05:30').getTime() / 1000,
      );
      expect(isNseSession(saturdaySec)).toBe(false);
    });
  });

  describe('buildTradeSetup', () => {
    it('builds CE-BUY setup with RR targets', () => {
      const setup = buildTradeSetup('CE-BUY', 25000, 24950, 20);
      expect(setup).toMatchObject({
        entry: 25000,
        risk: expect.any(Number),
        takeProfits: expect.arrayContaining([
          expect.objectContaining({ rr: '1:1' }),
        ]),
      });
    });

    it('returns undefined for NO-TRADE', () => {
      expect(buildTradeSetup('NO-TRADE', 25000, 24950, 20)).toBeUndefined();
    });
  });

  describe('sliceCandlesAfter', () => {
    it('slices forward window with optional until bound', () => {
      const candles = sampleCandles(8);
      const after = candles[2][0];
      const until = candles[5][0];
      const sliced = sliceCandlesAfter(candles, after, until);
      expect(sliced.length).toBeGreaterThan(0);
      expect(sliced.every((c) => c[0] > after && c[0] <= until)).toBe(true);
    });
  });

  describe('simulateTradeOutcome', () => {
    it('hits stop loss on CE-BUY replay', () => {
      const setup = buildTradeSetup('CE-BUY', 25000, 24950, 20)!;
      const forward: FyersAPI.Candle[] = [
        [1, 25000, 25010, 24940, 24945, 1000],
      ];
      const outcome = simulateTradeOutcome('CE-BUY', setup, forward);
      expect(outcome.status).toBe('STOP_LOSS');
      expect(outcome.pnlR).toBe(-1);
    });

    it('returns NO-TRADE status without setup', () => {
      expect(simulateTradeOutcome('NO-TRADE', undefined, [])).toMatchObject({
        status: 'NO-TRADE',
        pnl: 0,
      });
    });
  });
});