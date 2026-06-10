import { FastifyInstance } from 'fastify';
import { TELEGRAM_NOTIFICATION_DEFAULTS } from '../constants/telegram-notifications';
import { runTradingCoachAnalysis } from '../trading-coach/analyze';
import { resolveCoachDateRange } from '../trading-coach/fyers-trades';
import { SignalSnapshot } from '../types/telegram-notifications';
import { TradingStyle } from '../types/trading-style';
import {
  FYERS_AUTH_ERROR_REPLY,
  formatTelegramCoachOnDemandErrorMessage,
  formatTelegramCoachOnDemandMessage,
  isFyersAuthError,
  watchedStylesForCoach,
} from './coach-summary-formatter';
import { getIstSessionClock } from './signal-tracker';

function parseCoachStyle(value: string | undefined): TradingStyle | null {
  const upper = (value || '').toUpperCase();
  if (upper === TradingStyle.Scalper) return TradingStyle.Scalper;
  if (upper === TradingStyle.Positional) return TradingStyle.Positional;
  if (upper === TradingStyle.Intraday) return TradingStyle.Intraday;
  return null;
}

function resolveCoachDate(parts: string[]): string {
  const timezone = TELEGRAM_NOTIFICATION_DEFAULTS.IST_TIMEZONE;
  const { sessionDate } = getIstSessionClock(Date.now(), timezone);

  for (const part of parts.slice(1)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(part)) return part;
    if (part.toLowerCase() === 'today') return sessionDate;
  }

  return sessionDate;
}

export async function buildCoachTelegramMessage(
  fastify: FastifyInstance,
  params: {
    watchedSymbols: string[];
    watchedStyles: TradingStyle[];
    snapshots: SignalSnapshot[];
    styleFilter?: TradingStyle | null;
    sessionDate: string;
  },
): Promise<string> {
  const styles = params.styleFilter
    ? [params.styleFilter]
    : watchedStylesForCoach(params.watchedStyles);
  const indexFilter =
    params.watchedSymbols.length === 1 ? params.watchedSymbols[0] : undefined;
  const dateRange = resolveCoachDateRange({ date: params.sessionDate });

  const coaches = [];
  for (const tradingStyle of styles) {
    try {
      const coach = await runTradingCoachAnalysis(fastify, {
        tradingStyle,
        indexFilter,
        dateRange,
      });
      coaches.push(coach);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      if (isFyersAuthError(error)) return FYERS_AUTH_ERROR_REPLY;
      return formatTelegramCoachOnDemandErrorMessage({
        sessionDate: params.sessionDate,
        error,
      });
    }
  }

  return formatTelegramCoachOnDemandMessage({
    sessionDate: params.sessionDate,
    coaches,
    snapshots: params.snapshots,
  });
}

export function parseCoachCommandArgs(text: string): {
  sessionDate: string;
  styleFilter: TradingStyle | null;
} {
  const parts = text.split(/\s+/).filter(Boolean);
  const sessionDate = resolveCoachDate(parts);

  let styleFilter: TradingStyle | null = null;
  for (const part of parts.slice(1)) {
    const style = parseCoachStyle(part);
    if (style) {
      styleFilter = style;
      break;
    }
  }

  return { sessionDate, styleFilter };
}