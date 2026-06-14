import { FastifyInstance } from 'fastify';
import { FLIP_POLL_INTERVAL_MINUTES } from '../constants/trade-rr';
import { SESSION_TRADE_COOLDOWN_MINUTES, TIMELINE_DEFAULTS } from '../constants/technical-analysis';
import { getStyleScoringConfig } from '../trading-style';
import { buildPriceActionSnapshot } from '../technical-analysis/snapshot';
import {
  buildTimelineAnchors,
  computeWindow,
  getIstSessionKey,
  parseEpochMs,
  resolveSimulationUntilSec,
  sliceCandlesAfter,
  sliceCandlesUpTo,
  toIso,
} from '../technical-analysis/timeline-utils';
import { ResponseStatus } from '../types';
import { OptionChainSnapshotRecord } from '../types/option-chain-snapshot';
import { PriceActionResponse, TradeAction } from '../types/technical-analysis';
import { TradingStyle } from '../types/trading-style';
import { nearestOptionChainSnapshot } from '../telegram-notifications/option-chain-snapshot-store';
import {
  neutralOptionMetrics,
  snapshotToOptionMetrics,
} from './snapshot-to-option';
import { buildFlipExitSignals, BenchmarkAnchorRead } from './flip-exit-utils';
import {
  simulateTradeOutcomeWithTrailingFloor,
} from './trailing-tp-simulator';
import {
  BenchmarkAiMode,
  BenchmarkParams,
  BenchmarkReport,
  BenchmarkTradeRow,
} from './types';
import { buildAiVerdictSummary, buildEngineVerdict } from './verdict';
import {
  buildAiComparison,
  buildEquityCurve,
} from './summarize';
import {
  BENCHMARK_STOP_LOSS_NOTE,
  buildCapitalProjection,
} from './capital-curve';
import { buildBenchmarkTradeSetup } from './benchmark-trade-setup';
import { BENCHMARK_DEFAULT_STARTING_CAPITAL_INR } from '../constants/benchmark';

function parseTradingStyle(styleQuery?: string): TradingStyle {
  const styleStr = (styleQuery || 'INTRADAY').toUpperCase();
  if (styleStr === 'SCALPER' || styleStr === TradingStyle.Scalper) {
    return TradingStyle.Scalper;
  }
  if (styleStr === 'POSITIONAL' || styleStr === TradingStyle.Positional) {
    return TradingStyle.Positional;
  }
  return TradingStyle.Intraday;
}

async function loadSnapshotsForWindow(
  fastify: FastifyInstance,
  symbol: string,
  tradingStyle: TradingStyle,
  fromMs: number,
  toMs: number,
): Promise<OptionChainSnapshotRecord[]> {
  const col = fastify.mongo?.db?.collection<OptionChainSnapshotRecord>(
    'option-chain-snapshots',
  );
  if (!col) return [];

  const docs = await col
    .find({
      symbol,
      tradingStyle,
      bucketAt: { $gte: new Date(fromMs), $lte: new Date(toMs) },
    })
    .sort({ bucketAt: 1 })
    .toArray();

  return docs.map((doc) => ({
    ...doc,
    bucketAt:
      doc.bucketAt instanceof Date ? doc.bucketAt : new Date(doc.bucketAt),
    capturedAt:
      doc.capturedAt instanceof Date ? doc.capturedAt : new Date(doc.capturedAt),
    expiresAt:
      doc.expiresAt instanceof Date ? doc.expiresAt : new Date(doc.expiresAt),
  }));
}

function snapshotsForSession(
  all: OptionChainSnapshotRecord[],
  sessionKey: string,
): OptionChainSnapshotRecord[] {
  return all.filter(
    (s) => getIstSessionKey(Math.floor(s.bucketAt.getTime() / 1000)) === sessionKey,
  );
}

interface TradeCandidate {
  asOfMs: number;
  asOfSec: number;
  dayKey: string;
  action: 'CE-BUY' | 'PE-BUY';
  conviction: number;
  bias: string;
  snapshot: NonNullable<ReturnType<typeof buildPriceActionSnapshot>>;
  optionSource: 'snapshot' | 'neutral_fallback';
  optionData: ReturnType<typeof neutralOptionMetrics>;
  nearestSnap: OptionChainSnapshotRecord | null;
}

export async function runBenchmark(
  fastify: FastifyInstance,
  input: BenchmarkParams,
): Promise<BenchmarkReport> {
  const sessionReady = await fastify.ensureFyersSession();
  if (!sessionReady) {
    throw new Error('Fyers session expired — log in to run benchmark.');
  }

  const activeStyle = parseTradingStyle(input.tradingStyle);
  const vetoMode = input.vetoMode ?? 'strict';
  const flowMode = input.flowMode ?? 'blend';
  const aiMode: BenchmarkAiMode = input.aiMode ?? 'shadow';
  const maxAiCalls = input.maxAiCalls ?? 40;
  const maxTradesPerDay = input.maxTradesPerDay;
  const signalFlipExit = input.signalFlipExit !== false;
  const toMs = parseEpochMs(input.toMs, Date.now());
  const days = Math.min(
    TIMELINE_DEFAULTS.MAX_WINDOW_DAYS,
    Math.max(1, input.days ?? 14),
  );
  const intervalMinutes = Math.max(5, input.intervalMinutes ?? 15);
  const onlySession = input.sessionOnly !== false;
  const symbol = input.symbol;
  const enterThreshold =
    getStyleScoringConfig(activeStyle).convictionThreshold.enter;

  const { fromMs, fetchFromMs } = computeWindow(toMs, days);
  const toEpochSeconds = (ms: number) => Math.floor(ms / 1000).toString();

  const [res5m, res15m, res1h, snapshots] = await Promise.all([
    fastify.fyers.getHistory({
      symbol,
      resolution: '5',
      range_from: toEpochSeconds(fetchFromMs),
      range_to: toEpochSeconds(toMs),
      cont_flag: 1,
      oi_flag: 0,
      date_format: 0,
    }),
    fastify.fyers.getHistory({
      symbol,
      resolution: '15',
      range_from: toEpochSeconds(fetchFromMs),
      range_to: toEpochSeconds(toMs),
      cont_flag: 1,
      oi_flag: 0,
      date_format: 0,
    }),
    fastify.fyers.getHistory({
      symbol,
      resolution: '60',
      range_from: toEpochSeconds(fetchFromMs),
      range_to: toEpochSeconds(toMs),
      cont_flag: 1,
      oi_flag: 0,
      date_format: 0,
    }),
    loadSnapshotsForWindow(fastify, symbol, activeStyle, fromMs, toMs),
  ]);

  if (
    res5m.s !== ResponseStatus.ok ||
    res15m.s !== ResponseStatus.ok ||
    res1h.s !== ResponseStatus.ok ||
    !res5m.candles?.length
  ) {
    throw new Error('Failed to fetch candle history for benchmark window.');
  }

  const candles5m = res5m.candles;
  const candles15m = res15m.candles;
  const candles1h = res1h.candles;

  const anchors = buildTimelineAnchors(
    candles5m,
    fromMs,
    toMs,
    intervalMinutes,
    onlySession,
  );
  const flipPollAnchors = buildTimelineAnchors(
    candles5m,
    fromMs,
    toMs,
    FLIP_POLL_INTERVAL_MINUTES,
    onlySession,
  );

  const deps = {
    ta: fastify.technicalAnalysisPlugin,
    momentum: fastify.momentumDecayPlugin,
  };

  const flipPollReads: BenchmarkAnchorRead[] = [];
  const tradeCandidates: TradeCandidate[] = [];

  for (const asOfMs of anchors) {
    const asOfSec = Math.floor(asOfMs / 1000);
    const slice5m = sliceCandlesUpTo(candles5m, asOfSec);
    const slice15m = sliceCandlesUpTo(candles15m, asOfSec);
    const slice1h = sliceCandlesUpTo(candles1h, asOfSec);

    if (slice5m.length < TIMELINE_DEFAULTS.MIN_CANDLES_FOR_ANALYSIS) {
      continue;
    }

    const snapshot = buildPriceActionSnapshot(deps, {
      symbol,
      tradingStyle: activeStyle,
      candles5m: slice5m,
      candles15m: slice15m,
      candles1h: slice1h,
      asOfMs,
    });

    if (!snapshot) continue;

    const dayKey = getIstSessionKey(asOfSec);
    const sessionSnaps = snapshotsForSession(snapshots, dayKey);
    const nearestSnap = nearestOptionChainSnapshot(sessionSnaps, asOfMs);
    const optionSource = nearestSnap ? 'snapshot' : 'neutral_fallback';
    const optionData = nearestSnap
      ? snapshotToOptionMetrics(nearestSnap, symbol)
      : neutralOptionMetrics(symbol, snapshot.lastPrice);

    const decision = fastify.decisionEngine.computeTradeDecision(
      snapshot as PriceActionResponse,
      optionData,
      activeStyle,
      { vetoMode, flowMode },
    );

    if (decision.action !== 'CE-BUY' && decision.action !== 'PE-BUY') {
      continue;
    }

    if (decision.conviction < enterThreshold) {
      continue;
    }

    if (!snapshot.tradeSetup) continue;

    tradeCandidates.push({
      asOfMs,
      asOfSec,
      dayKey,
      action: decision.action,
      conviction: decision.conviction,
      bias: decision.bias,
      snapshot,
      optionSource,
      optionData,
      nearestSnap,
    });
  }

  for (const asOfMs of flipPollAnchors) {
    const asOfSec = Math.floor(asOfMs / 1000);
    const slice5m = sliceCandlesUpTo(candles5m, asOfSec);
    const slice15m = sliceCandlesUpTo(candles15m, asOfSec);
    const slice1h = sliceCandlesUpTo(candles1h, asOfSec);

    if (slice5m.length < TIMELINE_DEFAULTS.MIN_CANDLES_FOR_ANALYSIS) {
      continue;
    }

    const snapshot = buildPriceActionSnapshot(deps, {
      symbol,
      tradingStyle: activeStyle,
      candles5m: slice5m,
      candles15m: slice15m,
      candles1h: slice1h,
      asOfMs,
    });
    if (!snapshot) continue;

    const dayKey = getIstSessionKey(asOfSec);
    const sessionSnaps = snapshotsForSession(snapshots, dayKey);
    const nearestSnap = nearestOptionChainSnapshot(sessionSnaps, asOfMs);
    const optionData = nearestSnap
      ? snapshotToOptionMetrics(nearestSnap, symbol)
      : neutralOptionMetrics(symbol, snapshot.lastPrice);

    const decision = fastify.decisionEngine.computeTradeDecision(
      snapshot as PriceActionResponse,
      optionData,
      activeStyle,
      { vetoMode, flowMode },
    );

    flipPollReads.push({
      asOfMs,
      dayKey,
      action: decision.action,
      conviction: decision.conviction,
    });
  }

  const tradeCooldownMs = SESSION_TRADE_COOLDOWN_MINUTES * 60 * 1000;
  let sessionDayKey = '';
  let ceCooldownUntilMs = 0;
  let peCooldownUntilMs = 0;
  let sessionTradesTaken = 0;

  const baselineTrades: BenchmarkTradeRow[] = [];
  const activeTrades: BenchmarkTradeRow[] = [];
  let aiCalls = 0;

  for (const candidate of tradeCandidates) {
    const { asOfMs, asOfSec, dayKey, action, conviction, snapshot } = candidate;

    if (dayKey !== sessionDayKey) {
      sessionDayKey = dayKey;
      ceCooldownUntilMs = 0;
      peCooldownUntilMs = 0;
      sessionTradesTaken = 0;
    }

    if (maxTradesPerDay != null && sessionTradesTaken >= maxTradesPerDay) {
      continue;
    }

    if (action === 'CE-BUY' && asOfMs < ceCooldownUntilMs) continue;
    if (action === 'PE-BUY' && asOfMs < peCooldownUntilMs) continue;

    const baseSetup = snapshot.tradeSetup;
    if (!baseSetup) continue;

    const setup =
      buildBenchmarkTradeSetup(
        action,
        baseSetup.entry,
        baseSetup.rawStopLoss,
        baseSetup.atrUsed,
      ) ?? baseSetup;

    const { untilSec, scope } = resolveSimulationUntilSec(
      asOfSec,
      activeStyle,
      Math.floor(toMs / 1000),
    );
    const forward = sliceCandlesAfter(candles5m, asOfSec, untilSec);
    const flipExits = signalFlipExit
      ? buildFlipExitSignals(
          asOfMs,
          action,
          untilSec,
          flipPollReads,
          enterThreshold,
        )
      : [];

    const outcome = simulateTradeOutcomeWithTrailingFloor(
      action as TradeAction,
      setup,
      forward,
      scope,
      { flipExits, enableFlipExit: signalFlipExit },
    );

    if (outcome.status === 'NO-TRADE') continue;

    sessionTradesTaken += 1;

    const tp1 = setup.takeProfits.find((t) => t.multiplier === 1.5)?.price ?? 0;
    const tp2 = setup.takeProfits.find((t) => t.multiplier === 2.5)?.price ?? 0;
    const tp3 = setup.takeProfits.find((t) => t.multiplier === 4)?.price ?? 0;
    const pnlPercent =
      setup.entry > 0 ? +((outcome.pnl / setup.entry) * 100).toFixed(2) : 0;

    let aiAnalysis = undefined;
    let convictionWithAi = conviction;

    if (aiMode !== 'off' && aiCalls < maxAiCalls) {
      try {
        const primaryTf =
          activeStyle === TradingStyle.Scalper
            ? '5m'
            : activeStyle === TradingStyle.Positional
              ? '1h'
              : '15m';
        const primaryScore = snapshot.timeframeScores?.[primaryTf] ?? 0;
        aiAnalysis = await fastify.aiAgent.analyze({
          symbol,
          tradingStyle: activeStyle,
          action,
          conviction,
          bias: candidate.bias,
          priceAction: {
            primaryTF: primaryTf,
            primaryScore,
            levels: snapshot.levels,
            momentum: snapshot.momentum ?? {},
            structure: snapshot.structureElements ?? {},
          },
          optionFlow: {
            overallScore: candidate.optionData.score ?? 0,
            ivRegime: String(candidate.optionData.ivRegime ?? 'Normal IV'),
            topComponents: (candidate.nearestSnap?.components ?? [])
              .slice(0, 3)
              .map((c) => ({
                name: c.name,
                score: c.score,
                interpretation: c.interpretation ?? '',
              })),
          },
        });
        aiCalls += 1;
        if (aiMode === 'active' && aiAnalysis.confidenceAdjustment) {
          convictionWithAi = Math.min(
            95,
            Math.max(0, conviction + aiAnalysis.confidenceAdjustment),
          );
        }
      } catch (err) {
        fastify.log.warn({ err }, 'benchmark AI call failed');
      }
    }

    const row: BenchmarkTradeRow = {
      signalAtMs: asOfMs,
      signalAtISO: toIso(asOfMs),
      sessionDate: dayKey,
      action,
      indexEntry: setup.entry,
      indexExit: outcome.exitPrice,
      stopLoss: setup.stopLoss,
      takeProfit1: tp1,
      takeProfit2: tp2,
      takeProfit3: tp3,
      setup,
      exitStatus: outcome.status as BenchmarkTradeRow['exitStatus'],
      hitLevel: (outcome.hitLevel ?? 'OPEN') as BenchmarkTradeRow['hitLevel'],
      pnlPoints: outcome.pnl,
      pnlR: outcome.pnlR,
      pnlPercent,
      barsHeld: outcome.barsHeld,
      conviction,
      convictionWithAi:
        aiMode === 'active' ? convictionWithAi : undefined,
      optionSource: candidate.optionSource,
      engineVerdict: '',
      aiAnalysis,
    };
    row.engineVerdict = buildEngineVerdict(row);
    row.aiVerdictSummary = buildAiVerdictSummary(aiAnalysis, row);

    baselineTrades.push(row);

    if (aiMode === 'active') {
      if (convictionWithAi >= enterThreshold) {
        activeTrades.push({ ...row, conviction: convictionWithAi });
      }
    }

    const closedAtMs = outcome.exitAt ?? asOfMs;
    if (action === 'CE-BUY') {
      ceCooldownUntilMs = closedAtMs + tradeCooldownMs;
    } else {
      peCooldownUntilMs = closedAtMs + tradeCooldownMs;
    }
  }

  const snapshotDays = new Set(
    snapshots.map((s) =>
      getIstSessionKey(Math.floor(s.bucketAt.getTime() / 1000)),
    ),
  ).size;

  const startingCapitalInr =
    input.startingCapitalInr ?? BENCHMARK_DEFAULT_STARTING_CAPITAL_INR;
  const capitalProjection = buildCapitalProjection(
    baselineTrades,
    activeStyle,
    startingCapitalInr,
    input.riskPercentPerTrade,
  );

  const dailyCapNote =
    maxTradesPerDay != null
      ? `Max ${maxTradesPerDay} entr${maxTradesPerDay === 1 ? 'y' : 'ies'} per session day.`
      : 'Unlimited entries per session day.';

  const flipNote = signalFlipExit
    ? 'Signal-flip exit: once 1:1.5+ is locked, 2 consecutive opposite polls (5m replay / 60s live) exit at market.'
    : 'Signal-flip exit disabled for this run.';

  return {
    params: {
      ...input,
      symbol,
      tradingStyle: activeStyle,
      days,
      intervalMinutes,
      vetoMode,
      flowMode,
      aiMode,
      enterThreshold,
      maxTradesPerDay,
      signalFlipExit,
      startingCapitalInr,
      riskPercentPerTrade: capitalProjection.summary.riskPercentPerTrade,
    },
    simulationNote: [
      'Spot index simulation: 1:1.5/1:2.5/1:4 locks; past 1:4 trail ratchets at peakR − 1R; flip/SL first each bar.',
      dailyCapNote,
      flipNote,
    ].join(' '),
    optionFlowNote:
      snapshots.length > 0
        ? `Option snapshots used on ${snapshotDays} session day(s); neutral fallback elsewhere.`
        : 'No option snapshots in window — blend mode uses neutral option flow (PA-heavy).',
    aiComparison: buildAiComparison(
      baselineTrades,
      aiMode === 'active' ? activeTrades : aiMode === 'shadow' ? baselineTrades : null,
      aiMode,
      { signalFlipExit, maxTradesPerDay },
    ),
    trades: capitalProjection.trades,
    equityCurve: buildEquityCurve(baselineTrades),
    capitalSummary: capitalProjection.summary,
    capitalCurve: capitalProjection.capitalCurve,
    stopLossNote: BENCHMARK_STOP_LOSS_NOTE,
    generatedAt: new Date().toISOString(),
  };
}