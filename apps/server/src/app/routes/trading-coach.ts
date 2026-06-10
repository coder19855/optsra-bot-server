import { HttpStatusCode } from 'axios';
import { FastifyInstance } from 'fastify';
import {
  COACH_DEFAULT_POST_MINUTES,
  COACH_DEFAULT_PRE_MINUTES,
} from '../constants/trading-coach';
import { runTradingCoachAnalysis } from '../trading-coach/analyze';
import { resolveCoachDateRange } from '../trading-coach/fyers-trades';
import { TradingStyle } from '../types/trading-style';

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

      let response: Awaited<ReturnType<typeof runTradingCoachAnalysis>>;
      try {
        response = await runTradingCoachAnalysis(fastify, {
          tradingStyle: activeStyle,
          indexFilter,
          dateRange,
          preMinutes,
          postMinutes,
          tradeId,
        });
      } catch (error) {
        return reply.code(HttpStatusCode.BadGateway).send({
          error: error instanceof Error ? error.message : 'Failed to fetch Fyers trades',
        });
      }

      return reply.send(response);
    } catch (error) {
      fastify.log.error(error);
      return reply
        .status(HttpStatusCode.InternalServerError)
        .send({ error: 'Failed to analyze trades for trading coach' });
    }
  });
}