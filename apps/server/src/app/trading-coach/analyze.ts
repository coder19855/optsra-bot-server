import { FastifyInstance } from 'fastify';
import {
  COACH_DEFAULT_POST_MINUTES,
  COACH_DEFAULT_PRE_MINUTES,
} from '../constants/trading-coach';
import {
  CoachVerdict,
  TradingCoachResponse,
  TradingCoachTradeReport,
} from '../types/trading-coach';
import { TradingStyle } from '../types/trading-style';
import {
  CoachDateRange,
  fetchCoachTradeFills,
  fetchRealisedProfitSummary,
  resolveCoachDisplayPnlInr,
  sumRoundTripPnlInr,
} from './fyers-trades';
import { fetchIndexCandles, replayRoundTripTrade } from './replay';
import {
  countInternalCarryFills,
  mergeRoundTripLegs,
  pairRoundTripTrades,
} from './trade-pairing';
import { analyzeTradeVerdict } from './verdict';

export interface TradingCoachAnalysisOptions {
  tradingStyle: TradingStyle;
  indexFilter?: string;
  dateRange?: CoachDateRange | null;
  preMinutes?: number;
  postMinutes?: number;
  tradeId?: string;
}

export async function runTradingCoachAnalysis(
  fastify: FastifyInstance,
  options: TradingCoachAnalysisOptions,
): Promise<TradingCoachResponse> {
  const {
    tradingStyle: activeStyle,
    indexFilter,
    dateRange = null,
    preMinutes = COACH_DEFAULT_PRE_MINUTES,
    postMinutes = COACH_DEFAULT_POST_MINUTES,
    tradeId,
  } = options;

  const sessionReady = await fastify.ensureFyersSession();
  if (!sessionReady) {
    throw new Error(
      'Fyers access token is missing or expired — complete login via /api/login',
    );
  }

  const tradePayload = await fetchCoachTradeFills(fastify.fyers, dateRange);

  const internalCarryFillsExcluded = countInternalCarryFills(tradePayload.fills);
  const pairing = pairRoundTripTrades(tradePayload.fills);
  let roundTrips = pairing.roundTrips;
  let openPositions = pairing.openPositions;

  if (indexFilter) {
    roundTrips = roundTrips.filter((trade) => trade.indexSymbol === indexFilter);
    openPositions = openPositions.filter((pos) => pos.indexSymbol === indexFilter);
  }

  if (tradeId) {
    roundTrips = roundTrips.filter((trade) => trade.id === tradeId);
  } else {
    roundTrips = mergeRoundTripLegs(roundTrips);
  }

  const deps = {
    ta: fastify.technicalAnalysisPlugin,
    momentum: fastify.momentumDecayPlugin,
  };

  const reports: TradingCoachTradeReport[] = [];
  const skippedTrades: TradingCoachResponse['skippedTrades'] = [];
  const candleCache = new Map<
    string,
    Awaited<ReturnType<typeof fetchIndexCandles>>
  >();

  for (const trade of roundTrips) {
    const cacheKey = `${trade.indexSymbol}:${trade.sessionDate}`;
    let candles = candleCache.get(cacheKey);

    if (candles === undefined) {
      const fromMs = trade.entryAtMs - (preMinutes + 60) * 60 * 1000;
      const toMs = trade.exitAtMs + (postMinutes + 60) * 60 * 1000;
      candles = await fetchIndexCandles(
        fastify.fyers,
        trade.indexSymbol,
        fromMs,
        toMs,
      );
      candleCache.set(cacheKey, candles);
    }

    if (!candles || candles.candles5m.length < 30) {
      skippedTrades.push({
        reason: 'Insufficient index candle history for replay',
        symbol: trade.optionSymbol,
        entryAtISO: trade.entryAtISO,
      });
      continue;
    }

    const replay = replayRoundTripTrade(deps, trade, candles, activeStyle, {
      preMinutes,
      postMinutes,
    });

    const analysis = analyzeTradeVerdict(trade, replay, activeStyle);

    reports.push({
      trade,
      tradingStyle: activeStyle,
      replay,
      analysis,
    });
  }

  const verdicts: Record<CoachVerdict, number> = {
    good: 0,
    bad: 0,
    ugly: 0,
  };

  const fifoSessionPnlInr = sumRoundTripPnlInr(roundTrips);
  let systemApprovedCount = 0;
  let winCount = 0;
  let lossCount = 0;
  const roundTripSymbols = new Set<string>();

  for (const trade of roundTrips) {
    roundTripSymbols.add(trade.optionSymbol);
    if (trade.pnlInr > 0) winCount += 1;
    else if (trade.pnlInr < 0) lossCount += 1;
  }

  for (const report of reports) {
    verdicts[report.analysis.verdict] += 1;
    if (report.analysis.systemApproved) systemApprovedCount += 1;
  }

  let { pnlSummary, symbolPnl } = await fetchRealisedProfitSummary(
    fastify.fyers,
    dateRange,
    roundTripSymbols,
    fifoSessionPnlInr,
  );

  if (indexFilter && symbolPnl.length > 0) {
    symbolPnl = symbolPnl.filter((row) => row.indexSymbol === indexFilter);
  }

  const totalPnlInr = resolveCoachDisplayPnlInr({
    fifoSessionPnlInr,
    pnlSummary,
    symbolPnl,
    indexFilter: indexFilter ?? null,
    tradeSource: tradePayload.source,
  });

  const disclaimer =
    tradePayload.source === 'fyers_trade_history'
      ? 'Coaching replays Fyers trade history fills against historical index price action. Option flow is not reconstructed for past trades (same limitation as timeline backtest).'
      : 'Coaching replays today’s Fyers tradebook fills against index price action. Option flow is not reconstructed. Pass date, from_date/to_date, or days for backdated history.';

  return {
    source: tradePayload.source,
    dateRange: {
      fromDate: dateRange?.fromDate ?? null,
      toDate: dateRange?.toDate ?? null,
    },
    rawFillCount: tradePayload.rawFillCount,
    disclaimer,
    tradingStyle: activeStyle,
    indexFilter: indexFilter ?? null,
    sessionDateFilter: dateRange?.fromDate ?? null,
    generatedAt: new Date().toISOString(),
    summary: {
      totalRoundTrips: roundTrips.length,
      analyzed: reports.length,
      skipped: skippedTrades.length,
      internalCarryFillsExcluded,
      verdicts,
      totalPnlInr: +totalPnlInr.toFixed(2),
      computedRoundTripPnlInr: fifoSessionPnlInr,
      systemApprovedCount,
      winCount,
      lossCount,
      openPositionCount: openPositions.length,
    },
    pnlSummary,
    symbolPnl,
    openPositions,
    trades: reports,
    skippedTrades,
  };
}