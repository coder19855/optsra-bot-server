import { TELEGRAM_NOTIFICATION_DEFAULTS } from '../constants/telegram-notifications';
import { TradeDecisionAlertPayload } from '../types/telegram-notifications';
import { DecisionAction, TradeBias } from '../types/trade-decision';
import { DEFAULT_TELEGRAM_VOICE, TelegramVoice } from '../types/telegram-voice';
import { joinTelegramLines, joinTelegramSections } from './message-layout';
import { formatScenarioBanner } from './telegram-palette';
import { formatTradeContextLines, formatVetoSection } from './trade-context-copy';
import {
  signalActionLabel,
  signalConvictionLine,
  signalHeadline,
  signalOptionRead,
  signalPriceActionLine,
} from './voice-copy';
import {
  uiNowAlertsLine,
  uiNowBanner,
  uiNowClosedNote,
  uiNowEnterBarMet,
  uiNowFooter,
  uiNowFyersLine,
  uiNowMarketLine,
  uiNowNoStrike,
  uiNowTopPlaybook,
} from './voice-ui-copy';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function shortSymbol(symbol: string): string {
  const part = symbol.split(':')[1] || symbol;
  return part.replace('-INDEX', '');
}

function biasEmoji(bias: TradeBias): string {
  if (bias.includes('Bullish')) return '📈';
  if (bias.includes('Bearish')) return '📉';
  return '⏸';
}

function priceActionLine(
  pa: TradeDecisionAlertPayload['priceAction'],
  brainAction: DecisionAction,
  voice: TelegramVoice,
): string {
  const { action: paAction, confidence, structuralAction } = pa;
  const chartVetoed =
    confidence === 0 ||
    (brainAction === 'NO-TRADE' &&
      (paAction === 'NO-TRADE' || structuralAction != null));

  return signalPriceActionLine({
    voice,
    paAction,
    confidence,
    brainAction,
    chartVetoed,
    structuralAction,
    beforeDecay: pa.confidenceBeforeDecay,
  });
}

function formatIstTime(now = Date.now()): string {
  return new Date(now).toLocaleString('en-IN', {
    timeZone: TELEGRAM_NOTIFICATION_DEFAULTS.IST_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

export interface NowMarketContext {
  marketOpen: boolean;
  preSessionWindow: boolean;
  postSessionCoachWindow: boolean;
  isTokenValid: boolean;
  alertsPaused: boolean;
  fetchedAt?: number;
}

export function formatNowMarketContextBlock(
  ctx: NowMarketContext,
  voice: TelegramVoice = DEFAULT_TELEGRAM_VOICE,
): string {
  return joinTelegramLines(
    formatScenarioBanner('info', uiNowBanner(voice)),
    `🕐 ${formatIstTime(ctx.fetchedAt)} IST`,
    uiNowMarketLine(ctx, voice),
    uiNowFyersLine(ctx.isTokenValid, voice),
    uiNowAlertsLine(ctx.alertsPaused, voice),
    !ctx.marketOpen ? `<i>${uiNowClosedNote(voice)}</i>` : null,
  );
}

export function formatNowWatchItem(
  payload: TradeDecisionAlertPayload,
  voice: TelegramVoice = DEFAULT_TELEGRAM_VOICE,
): string {
  const label = shortSymbol(payload.symbol);
  const pa = payload.priceAction;
  const iv = payload.optionFlow?.ivRegime;
  const topStrategy = payload.recommendedStrategies[0];
  const strike = payload.exactStrikeRecommendation;
  const ready = payload.tradeGuidance.shouldConsiderTrade;

  const contextLines = formatTradeContextLines(
    payload.action,
    payload.bias,
    payload.conviction,
    payload.structureContext,
    voice,
  );

  const vetoSection = formatVetoSection(
    {
      action: payload.action,
      bias: payload.bias,
      conviction: payload.conviction,
      structureContext: payload.structureContext,
      priceAction: pa,
    },
    voice,
  );

  const readsBlock = joinTelegramLines(
    vetoSection ? null : priceActionLine(pa, payload.action, voice),
    signalOptionRead(payload.optionFlow?.bias, payload.action, voice),
    iv ? `🌡 IV: ${escapeHtml(iv)}` : null,
  );

  const headline = signalHeadline({
    voice,
    action: payload.action,
    flipped: false,
  });

  return joinTelegramLines(
    formatScenarioBanner(
      payload.action === 'CE-BUY'
        ? 'bullish'
        : payload.action === 'PE-BUY'
          ? 'bearish'
          : 'muted',
      headline,
    ),
    `<b>${escapeHtml(label)}</b> · ${payload.tradingStyle} · ${signalActionLabel(payload.action, voice)}`,
    `💰 Spot ${payload.lastPrice.toLocaleString('en-IN')} · ${biasEmoji(payload.bias)} ${escapeHtml(payload.bias)} · ${signalConvictionLine(payload.conviction, voice)}`,
    ...contextLines,
    vetoSection,
    readsBlock,
    uiNowEnterBarMet(ready, voice),
    strike
      ? `🎯 <code>${escapeHtml(strike.fyersSymbol)}</code> · ${strike.moneyness} @ ${strike.strike.toLocaleString('en-IN')}`
      : payload.action === 'CE-BUY' || payload.action === 'PE-BUY'
        ? uiNowNoStrike(voice)
        : null,
    topStrategy
      ? uiNowTopPlaybook(
          escapeHtml(topStrategy.strategy),
          topStrategy.confidenceScore ?? null,
          voice,
        )
      : null,
  );
}

export function formatNowTelegramMessage(params: {
  context: NowMarketContext;
  items: TradeDecisionAlertPayload[];
  errors?: Array<{ symbol: string; tradingStyle: string; error: string }>;
  voice?: TelegramVoice;
}): string {
  const voice = params.voice ?? DEFAULT_TELEGRAM_VOICE;
  const watchBlocks = params.items.map((item) => formatNowWatchItem(item, voice));
  const errorBlock =
    params.errors && params.errors.length > 0
      ? joinTelegramLines(
          voice === 'trader'
            ? '⚠️ Could not load:'
            : voice === 'marathi'
              ? '⚠️ Load nahi zala:'
              : '⚠️ Load nahi ho paya:',
          ...params.errors.map(
            (e) =>
              `• ${shortSymbol(e.symbol)} · ${e.tradingStyle}: ${escapeHtml(e.error)}`,
          ),
        )
      : null;

  return joinTelegramSections(
    formatNowMarketContextBlock(params.context, voice),
    ...watchBlocks,
    errorBlock,
    `<i>${uiNowFooter(voice)}</i>`,
  );
}