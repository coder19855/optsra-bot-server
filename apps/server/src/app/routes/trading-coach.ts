import { HttpStatusCode } from 'axios';
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
import { TradingStyle } from '../trading-style';
import {
  fetchCoachTradeFills,
  fetchRealisedProfitSummary,
  resolveCoachDateRange,
} from '../trading-coach/fyers-trades';
import {
  fetchIndexCandles,
  replayRoundTripTrade,
} from '../trading-coach/replay';
import {
  countInternalCarryFills,
  pairRoundTripTrades,
} from '../trading-coach/trade-pairing';
import { analyzeTradeVerdict } from '../trading-coach/verdict';

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

function parseOptionalPositiveInt(value: unknown): number | undefined {
  if (value === undefined || value === '') return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.floor(n);
}

export default async function tradingCoachRoute(fastify: FastifyInstance) {
  fastify.get('/api/trading-coach', async (request, reply) => {
    try {
      const {
        tradingStyle: styleQuery,
        symbol: indexFilter,
        date,
        from_date,
        to_date,
        days,
        preMinutes: preMinutesQuery,
        postMinutes: postMinutesQuery,
        tradeId,
      } = request.query as {
        tradingStyle?: string;
        symbol?: string;
        date?: string;
        from_date?: string;
        to_date?: string;
        days?: string | number;
        preMinutes?: string | number;
        postMinutes?: string | number;
        tradeId?: string;
      };

      const activeStyle = parseTradingStyle(styleQuery);
      const preMinutes =
        parseOptionalPositiveInt(preMinutesQuery) ?? COACH_DEFAULT_PRE_MINUTES;
      const postMinutes =
        parseOptionalPositiveInt(postMinutesQuery) ?? COACH_DEFAULT_POST_MINUTES;

      const dateRange = resolveCoachDateRange({ date, from_date, to_date, days });
      if (
        (date && !dateRange) ||
        (from_date && !dateRange) ||
        (to_date && !dateRange) ||
        (days !== undefined && days !== '' && !dateRange)
      ) {
        return reply.code(HttpStatusCode.BadRequest).send({
          error:
            'Invalid date filter. Use date=YYYY-MM-DD, from_date + to_date, or days=N (max 90).',
        });
      }

      let tradePayload: Awaited<ReturnType<typeof fetchCoachTradeFills>>;
      try {
        tradePayload = await fetchCoachTradeFills(fastify.fyers, dateRange);
      } catch (error) {
        return reply.code(HttpStatusCode.BadGateway).send({
          error: error instanceof Error ? error.message : 'Failed to fetch Fyers trades',
        });
      }

      const internalCarryFillsExcluded = countInternalCarryFills(
        tradePayload.fills,
      );
      let roundTrips = pairRoundTripTrades(tradePayload.fills);

      if (indexFilter) {
        roundTrips = roundTrips.filter(
          (trade) => trade.indexSymbol === indexFilter,
        );
      }

      if (tradeId) {
        roundTrips = roundTrips.filter((trade) => trade.id === tradeId);
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

        const replay = replayRoundTripTrade(
          deps,
          trade,
          candles,
          activeStyle,
          { preMinutes, postMinutes },
        );

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

      let computedRoundTripPnlInr = 0;
      let systemApprovedCount = 0;
      let winCount = 0;
      let lossCount = 0;
      const roundTripSymbols = new Set<string>();

      for (const report of reports) {
        verdicts[report.analysis.verdict] += 1;
        computedRoundTripPnlInr += report.trade.pnlInr;
        roundTripSymbols.add(report.trade.optionSymbol);
        if (report.analysis.systemApproved) systemApprovedCount += 1;
        if (report.trade.pnlInr > 0) winCount += 1;
        if (report.trade.pnlInr < 0) lossCount += 1;
      }

      let { pnlSummary, symbolPnl } = await fetchRealisedProfitSummary(
        fastify.fyers,
        dateRange,
        roundTripSymbols,
        computedRoundTripPnlInr,
      );

      if (indexFilter && symbolPnl.length > 0) {
        symbolPnl = symbolPnl.filter((row) => row.indexSymbol === indexFilter);
        if (pnlSummary) {
          const filteredGross = +symbolPnl
            .reduce((sum, row) => sum + row.realizedPnlInr, 0)
            .toFixed(2);
          pnlSummary = {
            ...pnlSummary,
            grossPnlInr: filteredGross,
            reconciled: Math.abs(filteredGross - pnlSummary.computedRoundTripPnlInr) < 1,
          };
        }
      }

      const totalPnlInr =
        pnlSummary?.grossPnlInr ?? +computedRoundTripPnlInr.toFixed(2);

      const disclaimer =
        tradePayload.source === 'fyers_trade_history'
          ? 'Coaching replays Fyers trade history fills against historical index price action. Option flow is not reconstructed for past trades (same limitation as timeline backtest).'
          : 'Coaching replays today’s Fyers tradebook fills against index price action. Option flow is not reconstructed. Pass date, from_date/to_date, or days for backdated history.';

      const response: TradingCoachResponse = {
        source: tradePayload.source,
        dateRange: {
          fromDate: dateRange?.fromDate ?? null,
          toDate: dateRange?.toDate ?? null,
        },
        rawFillCount: tradePayload.rawFillCount,
        disclaimer,
        tradingStyle: activeStyle,
        indexFilter: indexFilter ?? null,
        sessionDateFilter: date ?? null,
        generatedAt: new Date().toISOString(),
        summary: {
          totalRoundTrips: roundTrips.length,
          analyzed: reports.length,
          skipped: skippedTrades.length,
          internalCarryFillsExcluded,
          verdicts,
          totalPnlInr: +totalPnlInr.toFixed(2),
          computedRoundTripPnlInr: +computedRoundTripPnlInr.toFixed(2),
          systemApprovedCount,
          winCount,
          lossCount,
        },
        pnlSummary,
        symbolPnl,
        trades: reports,
        skippedTrades,
      };

      return reply.send(response);
    } catch (error) {
      fastify.log.error(error);
      return reply
        .status(HttpStatusCode.InternalServerError)
        .send({ error: 'Failed to analyze trades for trading coach' });
    }
  });
}