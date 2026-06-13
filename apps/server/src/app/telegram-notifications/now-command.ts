import { FastifyInstance } from 'fastify';
import { TELEGRAM_NOTIFICATION_DEFAULTS } from '../constants/telegram-notifications';
import { TradeDecisionAlertPayload } from '../types/telegram-notifications';
import { DEFAULT_TELEGRAM_VOICE, TelegramVoice } from '../types/telegram-voice';
import { TradingStyle } from '../types/trading-style';
import { parseSymbolStyleCommandArgs } from './command-args';
import {
  formatNowTelegramMessage,
  NowMarketContext,
} from './now-formatter';
import { fetchTradeDecisionAlert } from './trade-decision-fetch';
import {
  isIndianMarketOpen,
  isWithinPostSessionCoachWindow,
  isWithinPreSessionLearningWindow,
} from './signal-tracker';
import { computeManagementAdvice, getOpenPositionContext } from './position-monitor';

function resolveWatchList(
  text: string,
  watchedSymbols: string[],
  watchedStyles: TradingStyle[],
  defaults: { symbol: string; style: TradingStyle },
): Array<{ symbol: string; tradingStyle: TradingStyle }> {
  const parts = text.split(/\s+/).filter(Boolean);
  const hasArgs = parts.length > 1;

  if (hasArgs) {
    const { symbol, style } = parseSymbolStyleCommandArgs(text, defaults);
    return [{ symbol, tradingStyle: style }];
  }

  const items: Array<{ symbol: string; tradingStyle: TradingStyle }> = [];
  for (const symbol of watchedSymbols) {
    for (const tradingStyle of watchedStyles) {
      items.push({ symbol, tradingStyle });
    }
  }
  return items;
}

export async function buildNowTelegramMessage(
  fastify: FastifyInstance,
  params: {
    text: string;
    watchedSymbols: string[];
    watchedStyles: TradingStyle[];
    isAlertsPaused: boolean;
    voice?: TelegramVoice;
  },
): Promise<{
  message: string;
  error?: string;
  deckSymbol?: string;
  deckStyle?: string;
}> {
  const voice =
    params.voice ??
    fastify.telegramNotifications?.getVoice?.() ??
    DEFAULT_TELEGRAM_VOICE;
  const defaultSymbol = params.watchedSymbols[0] ?? 'NSE:NIFTY50-INDEX';
  const defaultStyle = params.watchedStyles[0] ?? TradingStyle.Intraday;

  const sessionReady = await fastify.ensureFyersSession({
    verifyWithApi: true,
  });
  if (!sessionReady) {
    return {
      message: '',
      error: 'Fyers session’s asleep — log in for a live market read.',
    };
  }

  const now = Date.now();
  const timezone = TELEGRAM_NOTIFICATION_DEFAULTS.IST_TIMEZONE;
  const context: NowMarketContext = {
    marketOpen: isIndianMarketOpen(
      now,
      timezone,
      TELEGRAM_NOTIFICATION_DEFAULTS.SESSION_OPEN,
      TELEGRAM_NOTIFICATION_DEFAULTS.SESSION_CLOSE,
    ),
    preSessionWindow: isWithinPreSessionLearningWindow(
      now,
      timezone,
      TELEGRAM_NOTIFICATION_DEFAULTS.PRE_SESSION_LEARNING_START,
      TELEGRAM_NOTIFICATION_DEFAULTS.PRE_SESSION_LEARNING_END,
    ),
    postSessionCoachWindow: isWithinPostSessionCoachWindow(
      now,
      timezone,
      TELEGRAM_NOTIFICATION_DEFAULTS.SESSION_CLOSE,
      TELEGRAM_NOTIFICATION_DEFAULTS.POST_SESSION_COACH_WINDOW_MINUTES,
    ),
    isTokenValid: true,
    alertsPaused: params.isAlertsPaused,
    fetchedAt: now,
  };

  const watchList = resolveWatchList(
    params.text,
    params.watchedSymbols,
    params.watchedStyles,
    { symbol: defaultSymbol, style: defaultStyle },
  );

  const items: TradeDecisionAlertPayload[] = [];
  const errors: Array<{
    symbol: string;
    tradingStyle: TradingStyle;
    error: string;
  }> = [];

  for (const watch of watchList) {
    try {
      const payload = await fetchTradeDecisionAlert(
        fastify,
        watch.symbol,
        watch.tradingStyle,
        {
          vetoMode: fastify.telegramNotifications.getVetoMode(),
          flowMode: fastify.telegramNotifications.getFlowMode(),
        },
      );
      if (payload) items.push(payload);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({
        symbol: watch.symbol,
        tradingStyle: watch.tradingStyle,
        error: msg,
      });
    }
  }

  if (!items.length && errors.length) {
    return {
      message: '',
      error: errors[0]?.error ?? 'Could not load market read.',
    };
  }

  const primaryItem = items[0];

  // Best-effort open position awareness for /now so the user sees context
  let openPositionNote: string | null = null;
  let managementAdvice: any = null;
  try {
    const primarySymbol = primaryItem?.symbol ?? watchList[0]?.symbol ?? defaultSymbol;
    const posCtx = await getOpenPositionContext(fastify, [primarySymbol]);
    if (posCtx.count > 0) {
      if (posCtx.isMixedDirections) {
        openPositionNote = 'Open positions detected (mixed directions on index) — current engine read is for management context only.';
      } else if (posCtx.heldDirection) {
        openPositionNote = `You hold ${posCtx.heldDirection} on ${primarySymbol}. This /now is the live engine read (for scaling/TP reference), not a new buy signal.`;
      }

      // Attach full management brain advice + health score for /now
      if (primaryItem) {
        managementAdvice = computeManagementAdvice(posCtx, primaryItem as any, { lastPrice: primaryItem.lastPrice } as any, primaryItem.tradingStyle);
        if (managementAdvice?.positionHealth) {
          const h = managementAdvice.positionHealth;
          const trend = h.trend === 'improving' ? '↑' : h.trend === 'deteriorating' ? '↓' : '';
          openPositionNote = (openPositionNote || '') + ` Health: ${h.score}/100 ${h.label} ${trend}`;
        }
      }
    }
  } catch {}

  return {
    message: formatNowTelegramMessage({ context, items, errors, voice }),
    deckSymbol: primaryItem?.symbol ?? watchList[0]?.symbol,
    deckStyle: String(
      primaryItem?.tradingStyle ?? watchList[0]?.tradingStyle ?? defaultStyle,
    ),
    openPositionNote,
    hasOpenPosition: !!openPositionNote,
    managementAdvice,
  };
}