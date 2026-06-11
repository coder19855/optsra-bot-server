import { AlertWhyContext } from '../types/alert-intelligence';
import { AdaptiveConvictionInsight } from '../types/adaptive-conviction';
import { ExactStrikeRecommendation } from '../types/exact-strike-recommendation';
import { formatEnginePickCallout } from './strike-callouts';
import { joinTelegramLines, joinTelegramSections } from './message-layout';
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
}): string {
  const { why, exactStrike, adaptive } = params;
  const label = shortSymbol(why.symbol);
  const actionScenario = scenarioForAction(why.action);
  const isAlert = why.wasNotified === true || why.source === 'alert';
  const time = new Date(why.alertedAt).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
  });

  const header = joinTelegramLines(
    formatScenarioBanner(
      'info',
      isAlert ? `Why · ${label} · ${why.tradingStyle}` : `Live · ${label} · ${why.tradingStyle}`,
    ),
    `${why.action} · ${why.conviction}% · ${escapeHtml(why.bias)} · 🕐 ${time}`,
    !isAlert ? 'No alert fired — live snapshot.' : null,
    why.action === 'NO-TRADE' || why.action === 'NEUTRAL'
      ? 'Sidelines — no strike pick.'
      : null,
  );

  const confluenceBlock =
    why.confluenceLines.length > 0
      ? joinTelegramLines(
          formatSectionHeader('learning', 'Conviction stack', '📊'),
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
            'Price action',
            why.action === 'PE-BUY' ? '📉' : '📈',
          ),
          ...why.priceActionLines.slice(0, 2).map((line) => escapeHtml(line)),
        )
      : null;

  const optionFlowBlock =
    why.optionFlowLines.length > 0
      ? joinTelegramLines(
          formatSectionHeader('info', 'Option flow', '🌊'),
          ...why.optionFlowLines.slice(0, 2).map((line) => escapeHtml(line)),
        )
      : null;

  const cautionBlock =
    why.vetoOrCaution.length > 0
      ? wrapScenarioCallout('warning', '<b>⚠️ Caution</b>', [
          ...why.vetoOrCaution.slice(0, 2).map((line) => escapeHtml(line)),
        ])
      : null;

  const strikeBlock = exactStrike
    ? formatEnginePickCallout(exactStrike, '<b>STRIKE</b>')
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