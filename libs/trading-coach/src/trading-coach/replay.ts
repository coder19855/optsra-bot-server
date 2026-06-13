import { FyersAPI } from 'fyers-api-v3';
import { FastifyInstance } from 'fastify';
import { HISTORY_LOOKBACK_DAYS } from '../constants/technical-analysis';
import {
  COACH_DEFAULT_POST_MINUTES,
  COACH_DEFAULT_PRE_MINUTES,
  COACH_PRE_SNAPSHOT_OFFSETS_MIN,
} from '../constants/trading-coach';
import { buildPriceActionSnapshot } from '../technical-analysis/snapshot';
import {
  calcOutcomeVsEnd,
  getNseSessionCloseSec,
  resolveSimulationUntilSec,
  simulateTradeOutcome,
  sliceCandlesAfter,
  sliceCandlesUpTo,
  toIso,
} from '../technical-analysis/timeline-utils';
import { PriceActionResponse } from '../types/technical-analysis';
import {
  CoachExcursion,
  CoachPostExit,
  CoachReplay,
  CoachSignalSnapshot,
  RoundTripTrade,
} from '../types/trading-coach';
import { TradingStyle } from '../types/trading-style';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function spotAtOrBefore(candles: FyersAPI.Candle[], asOfSec: number): number {
  const slice = sliceCandlesUpTo(candles, asOfSec);
  if (slice.length === 0) return 0;
  return slice[slice.length - 1][4];
}

function summarizeSnapshot(
  snapshot: PriceActionResponse,
  asOfMs: number,
  label: string,
): CoachSignalSnapshot {
  return {
    asOfMs,
    asOfISO: toIso(asOfMs),
    label,
    spot: snapshot.lastPrice,
    signal: {
      action: snapshot.signal.action,
      confidence: snapshot.signal.confidence,
      strength: snapshot.signal.strength,
      vetoReason: snapshot.signal.vetoReason,
    },
    timeframeScores: snapshot.timeframeScores,
    aligned: snapshot.confluence.aligned,
    mtfScore: snapshot.confluence.mtfScore,
    tradeSetup: snapshot.tradeSetup,
    decayPercent: snapshot.momentumDecay?.decayPercent,
    vetoedByDecay: snapshot.momentumDecay?.vetoedByDecay,
  };
}

function buildSnapshotAt(
  deps: {
    ta: FastifyInstance['technicalAnalysisPlugin'];
    momentum: FastifyInstance['momentumDecayPlugin'];
  },
  input: {
    symbol: string;
    tradingStyle: TradingStyle;
    candles5m: FyersAPI.Candle[];
    candles15m: FyersAPI.Candle[];
    candles1h: FyersAPI.Candle[];
    asOfMs: number;
  },
  label: string,
): CoachSignalSnapshot | null {
  const asOfSec = Math.floor(input.asOfMs / 1000);
  const snapshot = buildPriceActionSnapshot(deps, {
    symbol: input.symbol,
    tradingStyle: input.tradingStyle,
    candles5m: sliceCandlesUpTo(input.candles5m, asOfSec),
    candles15m: sliceCandlesUpTo(input.candles15m, asOfSec),
    candles1h: sliceCandlesUpTo(input.candles1h, asOfSec),
    asOfMs: input.asOfMs,
  });

  if (!snapshot) return null;
  return summarizeSnapshot(snapshot, input.asOfMs, label);
}

function computeExcursion(
  trade: RoundTripTrade,
  candles5m: FyersAPI.Candle[],
  setup: CoachSignalSnapshot | null,
): CoachExcursion | null {
  const entrySec = Math.floor(trade.entryAtMs / 1000);
  const exitSec = Math.floor(trade.exitAtMs / 1000);
  const holdCandles = sliceCandlesAfter(candles5m, entrySec, exitSec);

  if (holdCandles.length === 0) return null;

  const entrySpot = spotAtOrBefore(candles5m, entrySec);
  const exitSpot = spotAtOrBefore(candles5m, exitSec);
  if (entrySpot <= 0) return null;

  let mfe = 0;
  let mae = 0;

  for (const candle of holdCandles) {
    const [, , high, low] = candle;
    if (trade.direction === 'CE-BUY') {
      mfe = Math.max(mfe, high - entrySpot);
      mae = Math.max(mae, entrySpot - low);
    } else {
      mfe = Math.max(mfe, entrySpot - low);
      mae = Math.max(mae, high - entrySpot);
    }
  }

  const risk = setup?.tradeSetup?.risk ?? 0;
  const mfeR = risk > 0 ? +(mfe / risk).toFixed(3) : null;
  const maeR = risk > 0 ? +(mae / risk).toFixed(3) : null;

  return {
    mfePoints: +mfe.toFixed(2),
    maePoints: +mae.toFixed(2),
    mfeR,
    maeR,
    entrySpot: +entrySpot.toFixed(2),
    exitSpot: +exitSpot.toFixed(2),
  };
}

function computePostExit(
  trade: RoundTripTrade,
  candles5m: FyersAPI.Candle[],
  setup: CoachSignalSnapshot | null,
  postMinutes: number,
): CoachPostExit | null {
  const exitSec = Math.floor(trade.exitAtMs / 1000);
  const untilSec = exitSec + postMinutes * 60;
  const forward = sliceCandlesAfter(candles5m, exitSec, untilSec);
  if (forward.length === 0) return null;

  const exitSpot = spotAtOrBefore(candles5m, exitSec);
  const endSpot = forward[forward.length - 1][4];
  if (exitSpot <= 0) return null;

  const direction = trade.direction === 'CE-BUY' ? 1 : -1;
  const move = calcOutcomeVsEnd(exitSpot, endSpot, direction as 1 | -1);
  const risk = setup?.tradeSetup?.risk ?? 0;
  const spotMoveR =
    risk > 0 ? +(move.pnl / risk).toFixed(3) : null;

  return {
    windowMinutes: postMinutes,
    spotMovePoints: move.pnl,
    spotMoveR,
    continuedInFavor: move.pnl > 0,
    reversedAfterExit: move.pnl < 0,
  };
}

export async function fetchIndexCandles(
  fyers: FastifyInstance['fyers'],
  indexSymbol: string,
  fromMs: number,
  toMs: number,
): Promise<{
  candles5m: FyersAPI.Candle[];
  candles15m: FyersAPI.Candle[];
  candles1h: FyersAPI.Candle[];
} | null> {
  const toEpochSeconds = (ms: number) => Math.floor(ms / 1000).toString();
  const fetchFromMs = fromMs - HISTORY_LOOKBACK_DAYS * MS_PER_DAY;
  const cont_flag = 1;
  const oi_flag = 0;
  const date_format = 0;

  const [res5m, res15m, res1h] = await Promise.all([
    fyers.getHistory({
      symbol: indexSymbol,
      resolution: '5',
      range_from: toEpochSeconds(fetchFromMs),
      range_to: toEpochSeconds(toMs),
      cont_flag,
      oi_flag,
      date_format,
    }),
    fyers.getHistory({
      symbol: indexSymbol,
      resolution: '15',
      range_from: toEpochSeconds(fetchFromMs),
      range_to: toEpochSeconds(toMs),
      cont_flag,
      oi_flag,
      date_format,
    }),
    fyers.getHistory({
      symbol: indexSymbol,
      resolution: '60',
      range_from: toEpochSeconds(fetchFromMs),
      range_to: toEpochSeconds(toMs),
      cont_flag,
      oi_flag,
      date_format,
    }),
  ]);

  if (res5m.s !== 'ok' || res15m.s !== 'ok' || res1h.s !== 'ok') {
    return null;
  }

  return {
    candles5m: res5m.candles,
    candles15m: res15m.candles,
    candles1h: res1h.candles,
  };
}

export function replayRoundTripTrade(
  deps: {
    ta: FastifyInstance['technicalAnalysisPlugin'];
    momentum: FastifyInstance['momentumDecayPlugin'];
  },
  trade: RoundTripTrade,
  candles: {
    candles5m: FyersAPI.Candle[];
    candles15m: FyersAPI.Candle[];
    candles1h: FyersAPI.Candle[];
  },
  tradingStyle: TradingStyle,
  options?: {
    preMinutes?: number;
    postMinutes?: number;
  },
): CoachReplay {
  const preMinutes = options?.preMinutes ?? COACH_DEFAULT_PRE_MINUTES;
  const postMinutes = options?.postMinutes ?? COACH_DEFAULT_POST_MINUTES;

  const baseInput = {
    symbol: trade.indexSymbol,
    tradingStyle,
    candles5m: candles.candles5m,
    candles15m: candles.candles15m,
    candles1h: candles.candles1h,
  };

  const preTrade = COACH_PRE_SNAPSHOT_OFFSETS_MIN.map((offsetMin) => {
    const asOfMs = trade.entryAtMs - offsetMin * 60 * 1000;
    if (asOfMs < trade.entryAtMs - preMinutes * 60 * 1000) {
      return null;
    }
    return buildSnapshotAt(
      deps,
      { ...baseInput, asOfMs },
      `${offsetMin}m before entry`,
    );
  }).filter((item): item is CoachSignalSnapshot => item !== null);

  const atEntry = buildSnapshotAt(
    deps,
    { ...baseInput, asOfMs: trade.entryAtMs },
    'At entry',
  );

  const atExit = buildSnapshotAt(
    deps,
    { ...baseInput, asOfMs: trade.exitAtMs },
    'At exit',
  );

  let expectedOutcome = null;
  if (atEntry?.tradeSetup && atEntry.signal.action !== 'NO-TRADE') {
    const entrySec = Math.floor(trade.entryAtMs / 1000);
    const exitSec = Math.floor(trade.exitAtMs / 1000);
    const sessionClose = getNseSessionCloseSec(entrySec);
    const { untilSec, scope } = resolveSimulationUntilSec(
      entrySec,
      tradingStyle,
      sessionClose,
    );
    const forward = sliceCandlesAfter(
      candles.candles5m,
      entrySec,
      Math.min(untilSec, exitSec),
    );
    expectedOutcome = simulateTradeOutcome(
      atEntry.signal.action,
      atEntry.tradeSetup,
      forward,
      scope,
    );
  }

  const excursion = computeExcursion(trade, candles.candles5m, atEntry);
  const postExit = computePostExit(
    trade,
    candles.candles5m,
    atEntry,
    postMinutes,
  );

  return {
    mode: 'price_action_only',
    note:
      'Replay uses historical index price action only. Option flow is not reconstructed for past fills.',
    preTradeMinutes: preMinutes,
    postTradeMinutes: postMinutes,
    preTrade,
    atEntry,
    atExit,
    expectedOutcome,
    excursion,
    postExit,
  };
}