import { HttpStatusCode } from 'axios';
import { FastifyInstance } from 'fastify';
import {
  SESSION_OVERLAP_GUARD,
  SESSION_TRADE_COOLDOWN_MINUTES,
  TIMELINE_DEFAULTS,
  TIMELINE_STOP_ATR,
} from '../constants/technical-analysis';
import { buildPriceActionSnapshot } from '../technical-analysis/snapshot';
import {
  buildTimelineAnchors,
  calcOutcomeVsEnd,
  computeWindow,
  getIstSessionKey,
  parseEpochMs,
  resolveSimulationUntilSec,
  simulateTradeOutcome,
  sliceCandlesAfter,
  sliceCandlesUpTo,
  toIso,
} from '../technical-analysis/timeline-utils';
import { ResponseStatus } from '../types';
import {
  RrLabel,
  TechnicalAnalysisTimelineResponse,
  TimelinePoint,
  TradeAction,
} from '../types/technical-analysis';
import { TradingStyle } from '../trading-style';

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

export default async function technicalAnalysisTimelineRoute(
  fastify: FastifyInstance,
) {
  fastify.get('/api/technical-analysis/timeline', async (request, reply) => {
    try {
      const {
        symbol,
        tradingStyle: styleQuery,
        to,
        days,
        interval,
        sessionOnly,
      } = request.query as {
        symbol: string;
        tradingStyle?: string;
        to?: string | number;
        days?: string | number;
        interval?: string | number;
        sessionOnly?: string | boolean;
      };

      if (!symbol) {
        return reply.code(400).send({ error: 'symbol is required' });
      }

      const activeStyle = parseTradingStyle(styleQuery);
      const toMs = parseEpochMs(to, Date.now());
      const requestedDays =
        days !== undefined && days !== '' ? Number(days) : undefined;
      const windowDays = Math.min(
        TIMELINE_DEFAULTS.MAX_WINDOW_DAYS,
        Math.max(
          TIMELINE_DEFAULTS.MIN_WINDOW_DAYS,
          Number.isFinite(requestedDays) && requestedDays! > 0
            ? requestedDays!
            : TIMELINE_DEFAULTS.WINDOW_DAYS,
        ),
      );
      const intervalMinutes = Math.max(
        5,
        Number(interval) || TIMELINE_DEFAULTS.INTERVAL_MINUTES,
      );
      const onlySession =
        sessionOnly === undefined ||
        sessionOnly === 'true' ||
        sessionOnly === true;

      const { fromMs, fetchFromMs } = computeWindow(toMs, windowDays);
      const toEpochSeconds = (ms: number) => Math.floor(ms / 1000).toString();

      const cont_flag = 1;
      const oi_flag = 0;
      const date_format = 0;

      const [res5m, res15m, res1h] = await Promise.all([
        fastify.fyers.getHistory({
          symbol,
          resolution: '5',
          range_from: toEpochSeconds(fetchFromMs),
          range_to: toEpochSeconds(toMs),
          cont_flag,
          oi_flag,
          date_format,
        }),
        fastify.fyers.getHistory({
          symbol,
          resolution: '15',
          range_from: toEpochSeconds(fetchFromMs),
          range_to: toEpochSeconds(toMs),
          cont_flag,
          oi_flag,
          date_format,
        }),
        fastify.fyers.getHistory({
          symbol,
          resolution: '60',
          range_from: toEpochSeconds(fetchFromMs),
          range_to: toEpochSeconds(toMs),
          cont_flag,
          oi_flag,
          date_format,
        }),
      ]);

      if (
        res5m.s !== ResponseStatus.ok ||
        res15m.s !== ResponseStatus.ok ||
        res1h.s !== ResponseStatus.ok
      ) {
        return reply.code(HttpStatusCode.BadRequest).send({
          error: res5m.message || res15m.message || res1h.message,
        });
      }

      const candles5m = res5m.candles;
      const candles15m = res15m.candles;
      const candles1h = res1h.candles;

      if (candles5m.length === 0) {
        return reply.code(400).send({
          error: 'No candle data available for the requested window',
        });
      }

      const anchors = buildTimelineAnchors(
        candles5m,
        fromMs,
        toMs,
        intervalMinutes,
        onlySession,
      );

      if (anchors.length === 0) {
        return reply.code(400).send({
          error:
            'No session candles found in the analysis window. Try sessionOnly=false or a different date range.',
        });
      }

      const deps = {
        ta: fastify.technicalAnalysisPlugin,
        momentum: fastify.momentumDecayPlugin,
      };

      const endSpot =
        candles5m[candles5m.length - 1][4] ||
        candles15m[candles15m.length - 1]?.[4] ||
        0;

      const points: TimelinePoint[] = [];
      const signalCounts: Record<TradeAction, number> = {
        'CE-BUY': 0,
        'PE-BUY': 0,
        'NO-TRADE': 0,
      };
      let confidenceTotal = 0;
      let pnlRTotal = 0;
      let tradedPoints = 0;
      const tradeOutcomes = {
        stopLoss: 0,
        takeProfit: { '1:1': 0, '1:2': 0, '1:3': 0 } as Record<RrLabel, number>,
        sessionEnd: 0,
        open: 0,
        noTrade: 0,
      };
      let decayPercentTotal = 0;
      let decaySampleCount = 0;
      let vetoedByDecayCount = 0;

      const windowToSec = Math.floor(toMs / 1000);
      const defaultSimScope =
        activeStyle === TradingStyle.Positional ? 'window' : 'session';

      const tradeCooldownMs = SESSION_TRADE_COOLDOWN_MINUTES * 60 * 1000;
      let sessionDayKey = '';
      let ceCooldownUntilMs = 0;
      let peCooldownUntilMs = 0;
      let ceOpenUntilMs = 0;
      let peOpenUntilMs = 0;

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
        if (dayKey !== sessionDayKey) {
          sessionDayKey = dayKey;
          ceCooldownUntilMs = 0;
          peCooldownUntilMs = 0;
          ceOpenUntilMs = 0;
          peOpenUntilMs = 0;
        }

        let signalAction = snapshot.signal.action;
        let signalConfidence = snapshot.signal.confidence;
        let signalStrength = snapshot.signal.strength;
        let tradeSetup = snapshot.tradeSetup;
        let vetoReason = snapshot.signal.vetoReason;
        let structuralAction = snapshot.signal.structuralAction;

        if (
          activeStyle === TradingStyle.Intraday &&
          SESSION_OVERLAP_GUARD.ENABLED &&
          signalAction === 'CE-BUY' &&
          asOfMs < ceOpenUntilMs
        ) {
          signalAction = 'NO-TRADE';
          signalConfidence = 0;
          signalStrength = 'LOW';
          tradeSetup = undefined;
          vetoReason = 'Session overlap: CE position still open from prior entry';
          structuralAction = 'CE-BUY';
        } else if (
          activeStyle === TradingStyle.Intraday &&
          SESSION_OVERLAP_GUARD.ENABLED &&
          signalAction === 'PE-BUY' &&
          asOfMs < peOpenUntilMs
        ) {
          signalAction = 'NO-TRADE';
          signalConfidence = 0;
          signalStrength = 'LOW';
          tradeSetup = undefined;
          vetoReason = 'Session overlap: PE position still open from prior entry';
          structuralAction = 'PE-BUY';
        } else if (
          activeStyle === TradingStyle.Intraday &&
          signalAction === 'CE-BUY' &&
          asOfMs < ceCooldownUntilMs
        ) {
          signalAction = 'NO-TRADE';
          signalConfidence = 0;
          signalStrength = 'LOW';
          tradeSetup = undefined;
          vetoReason = `Session cooldown: CE blocked for ${SESSION_TRADE_COOLDOWN_MINUTES}m after prior CE trade`;
          structuralAction = 'CE-BUY';
        } else if (
          activeStyle === TradingStyle.Intraday &&
          signalAction === 'PE-BUY' &&
          asOfMs < peCooldownUntilMs
        ) {
          signalAction = 'NO-TRADE';
          signalConfidence = 0;
          signalStrength = 'LOW';
          tradeSetup = undefined;
          vetoReason = `Session cooldown: PE blocked for ${SESSION_TRADE_COOLDOWN_MINUTES}m after prior PE trade`;
          structuralAction = 'PE-BUY';
        }

        signalCounts[signalAction] += 1;
        confidenceTotal += signalConfidence;

        if (snapshot.momentumDecay) {
          decayPercentTotal += snapshot.momentumDecay.decayPercent;
          decaySampleCount += 1;
          if (snapshot.momentumDecay.vetoedByDecay) {
            vetoedByDecayCount += 1;
          }
        }

        const { untilSec, scope: pointSimScope } = resolveSimulationUntilSec(
          asOfSec,
          activeStyle,
          windowToSec,
        );
        const forwardCandles = sliceCandlesAfter(
          candles5m,
          asOfSec,
          untilSec,
        );
        const tradeOutcome = simulateTradeOutcome(
          signalAction,
          tradeSetup,
          forwardCandles,
          pointSimScope,
        );

        if (
          activeStyle === TradingStyle.Intraday &&
          tradeOutcome.status !== 'NO-TRADE'
        ) {
          const closedAtMs = tradeOutcome.exitAt ?? asOfMs;
          if (signalAction === 'CE-BUY') {
            if (SESSION_OVERLAP_GUARD.ENABLED && tradeOutcome.exitAt) {
              ceOpenUntilMs = tradeOutcome.exitAt;
            }
            ceCooldownUntilMs = closedAtMs + tradeCooldownMs;
          }
          if (signalAction === 'PE-BUY') {
            if (SESSION_OVERLAP_GUARD.ENABLED && tradeOutcome.exitAt) {
              peOpenUntilMs = tradeOutcome.exitAt;
            }
            peCooldownUntilMs = closedAtMs + tradeCooldownMs;
          }
        }

        if (tradeOutcome.status === 'NO-TRADE') {
          tradeOutcomes.noTrade += 1;
        } else if (tradeOutcome.status === 'SESSION_END') {
          tradeOutcomes.sessionEnd += 1;
          tradedPoints += 1;
          pnlRTotal += tradeOutcome.pnlR;
        } else if (tradeOutcome.status === 'STOP_LOSS') {
          tradeOutcomes.stopLoss += 1;
          tradedPoints += 1;
          pnlRTotal += tradeOutcome.pnlR;
        } else if (tradeOutcome.status === 'TAKE_PROFIT') {
          if (
            tradeOutcome.hitLevel === '1:1' ||
            tradeOutcome.hitLevel === '1:2' ||
            tradeOutcome.hitLevel === '1:3'
          ) {
            tradeOutcomes.takeProfit[tradeOutcome.hitLevel] += 1;
          }
          tradedPoints += 1;
          pnlRTotal += tradeOutcome.pnlR;
        } else {
          tradeOutcomes.open += 1;
          tradedPoints += 1;
          pnlRTotal += tradeOutcome.pnlR;
        }

        const direction =
          signalAction === 'CE-BUY'
            ? 1
            : signalAction === 'PE-BUY'
              ? -1
              : 0;

        points.push({
          asOf: asOfMs,
          asOfISO: toIso(asOfMs),
          spot: snapshot.lastPrice,
          primaryTimeframe: snapshot.primaryTimeframe as TimelinePoint['primaryTimeframe'],
          timeframeScores: snapshot.timeframeScores,
          mtfScore: snapshot.confluence.mtfScore,
          aligned: snapshot.confluence.aligned,
          signal: {
            action: signalAction,
            confidence: signalConfidence,
            strength: signalStrength,
            vetoReason,
            structuralAction,
          },
          candlestick: snapshot.candlestick,
          momentum: {
            recent: snapshot.momentum?.recent ?? {
              '5m': 0,
              '15m': 0,
              '1h': 0,
            },
            adx: snapshot.adx,
          },
          momentumDecay: snapshot.momentumDecay,
          confluenceContext: snapshot.confluenceContext,
          levels: snapshot.levels,
          tradeSetup,
          tradeOutcome,
          outcomeVsEnd: calcOutcomeVsEnd(
            tradeSetup?.entry ?? snapshot.lastPrice,
            endSpot,
            direction as 1 | -1 | 0,
          ),
        });
      }

      if (points.length === 0) {
        return reply.code(400).send({
          error:
            'Insufficient candle history to compute timeline points. Widen the fetch window or reduce interval.',
        });
      }

      const vetoBreakdown: Record<string, number> = {};
      let winningTrades = 0;
      for (const pt of points) {
        const reason = pt.signal.vetoReason;
        if (reason && pt.signal.action === 'NO-TRADE') {
          vetoBreakdown[reason] = (vetoBreakdown[reason] ?? 0) + 1;
        }
        if (
          pt.tradeOutcome.status !== 'NO-TRADE' &&
          pt.tradeOutcome.pnlR > 0
        ) {
          winningTrades += 1;
        }
      }

      const response: TechnicalAnalysisTimelineResponse = {
        replayMode: 'price_action_only',
        optionFlowNote:
          'Historical option chain is not available. Timeline uses price action only.',
        simulation: {
          scope: defaultSimScope,
          stopModel: 'atr_clamped_swing',
          rrTargets: ['1:1', '1:2', '1:3'],
          atrStopBand: {
            minMult: TIMELINE_STOP_ATR.MIN_MULT,
            maxMult: TIMELINE_STOP_ATR.MAX_MULT,
          },
          sessionCooldownMinutes: SESSION_TRADE_COOLDOWN_MINUTES,
        },
        symbol,
        tradingStyle: activeStyle,
        window: {
          from: fromMs,
          to: toMs,
          fromISO: toIso(fromMs),
          toISO: toIso(toMs),
          days: windowDays,
          ...(requestedDays !== undefined &&
          Number.isFinite(requestedDays) &&
          requestedDays > 0
            ? { requestedDays }
            : {}),
          maxDays: TIMELINE_DEFAULTS.MAX_WINDOW_DAYS,
          minDays: TIMELINE_DEFAULTS.MIN_WINDOW_DAYS,
        },
        intervalMinutes,
        sessionOnly: onlySession,
        summary: {
          totalPoints: points.length,
          signals: signalCounts,
          avgConfidence: +(confidenceTotal / points.length).toFixed(1),
          endSpot: +endSpot.toFixed(2),
          tradeOutcomes,
          decay: {
            vetoedCount: vetoedByDecayCount,
            avgDecayPercent: decaySampleCount
              ? +(decayPercentTotal / decaySampleCount).toFixed(1)
              : 0,
          },
          avgPnlR: tradedPoints
            ? +(pnlRTotal / tradedPoints).toFixed(3)
            : 0,
          totalTrades: tradedPoints,
          totalPnlR: +pnlRTotal.toFixed(3),
          winRate: tradedPoints
            ? +(winningTrades / tradedPoints).toFixed(3)
            : 0,
          vetoBreakdown,
        },
        points,
      };

      reply.send(response);
    } catch (error) {
      reply
        .status(HttpStatusCode.InternalServerError)
        .send({ error: 'Failed to compute technical analysis timeline' });
    }
  });
}