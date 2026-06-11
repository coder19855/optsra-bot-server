import { AlertWhyContext } from '../types/alert-intelligence';
import { TradeStructureContext } from '../types/telegram-notifications';
import { AdaptiveConvictionInsight } from '../types/adaptive-conviction';
import { ExactStrikeRecommendation } from '../types/exact-strike-recommendation';
import { formatEnginePickCallout } from './strike-callouts';
import { joinTelegramLines, joinTelegramSections } from './message-layout';
import { DEFAULT_TELEGRAM_VOICE, TelegramVoice } from '../types/telegram-voice';
import { formatTradeContextLines } from './trade-context-copy';
import {
  uiWhyCaution,
  uiWhyConvictionStack,
  uiWhyNoAlert,
  uiWhyOptionFlow,
  uiWhyPriceAction,
  uiWhySidelines,
  uiWhyStrike,
  uiWhyTitle,
} from './voice-ui-copy';
import {
  formatScenarioBanner,
  formatSectionHeader,
  scenarioForAction,
  wrapScenarioCallout,
} from './telegram-palette';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function shortSymbol(symbol: string): string {
  return symbol.split(':')[1]?.replace('-INDEX', '') ?? symbol;
}

export function formatWhyAlertMessage(params: {
  why: AlertWhyContext;
  exactStrike?: ExactStrikeRecommendation;
  adaptive?: AdaptiveConvictionInsight;
  structureContext?: TradeStructureContext;
  voice?: TelegramVoice;
}): string {
  const { why, exactStrike, adaptive, structureContext, voice = DEFAULT_TELEGRAM_VOICE } = params;
  const label = shortSymbol(why.symbol);
  const actionScenario = scenarioForAction(why.action);
  const isAlert = why.wasNotified === true || why.source === 'alert';
  const time = new Date(why.alertedAt).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
  });

  const contextLines = formatTradeContextLines(
    why.action,
    why.bias,
    why.conviction,
    structureContext,
    voice,
  );

  const header = joinTelegramLines(
    formatScenarioBanner(
      'info',
      uiWhyTitle(voice, {
        isAlert,
        label,
        style: why.tradingStyle,
      }),
    ),
    `${why.action} · ${why.conviction}% · ${escapeHtml(why.bias)} · 🕐 ${time}`,
    !isAlert ? uiWhyNoAlert(voice) : null,
    why.action === 'NO-TRADE' || why.action === 'NEUTRAL'
      ? uiWhySidelines(voice)
      : null,
    ...contextLines,
  );

  const confluenceBlock =
    why.confluenceLines.length > 0
      ? joinTelegramLines(
          formatSectionHeader('learning', uiWhyConvictionStack(voice), '📊'),
          ...why.confluenceLines
            .slice(0, 3)
            .map((line) => escapeHtml(line)),
        )
      : null;

  const priceActionBlock =
    why.priceActionLines.length > 0
      ? joinTelegramLines(
          formatSectionHeader(
            actionScenario,
            uiWhyPriceAction(voice),
            why.action === 'PE-BUY' ? '📉' : '📈',
          ),
          ...why.priceActionLines.slice(0, 2).map((line) => escapeHtml(line)),
        )
      : null;

  const optionFlowBlock =
    why.optionFlowLines.length > 0
      ? joinTelegramLines(
          formatSectionHeader('info', uiWhyOptionFlow(voice), '🌊'),
          ...why.optionFlowLines.slice(0, 2).map((line) => escapeHtml(line)),
        )
      : null;

  const cautionBlock =
    why.vetoOrCaution.length > 0
      ? wrapScenarioCallout('warning', `<b>⚠️ ${uiWhyCaution(voice)}</b>`, [
          ...why.vetoOrCaution.slice(0, 2).map((line) => escapeHtml(line)),
        ])
      : null;

  const strikeBlock = exactStrike
    ? formatEnginePickCallout(exactStrike, `<b>${uiWhyStrike(voice)}</b>`)
    : null;

  const adaptiveBlock = adaptive ? `📈 ${escapeHtml(adaptive.summary)}` : null;

  const summaryBlock = `🧠 ${escapeHtml(why.humanSummary)}`;

  return joinTelegramSections(
    header,
    confluenceBlock,
    priceActionBlock,
    optionFlowBlock,
    cautionBlock,
    strikeBlock,
    adaptiveBlock,
    summaryBlock,
  );
}