import { AlertWhyContext } from '../types/alert-intelligence';
import { AdaptiveConvictionInsight } from '../types/adaptive-conviction';
import { ExactStrikeRecommendation } from '../types/exact-strike-recommendation';
import { formatEnginePickCallout } from './strike-callouts';
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

  const lines: string[] = [
    formatScenarioBanner(
      'info',
      isAlert ? `Why · ${label} · ${why.tradingStyle}` : `Live · ${label} · ${why.tradingStyle}`,
    ),
    `${why.action} · ${why.conviction}% · ${escapeHtml(why.bias)} · 🕐 ${time}`,
  ];

  if (!isAlert) {
    lines.push('No alert fired — live snapshot.');
  }

  if (why.action === 'NO-TRADE' || why.action === 'NEUTRAL') {
    lines.push('Sidelines — no strike pick.');
  }

  if (why.confluenceLines.length) {
    lines.push(
      '',
      formatSectionHeader('learning', 'Conviction stack', '📊'),
      ...why.confluenceLines
        .slice(0, 3)
        .map((line) => escapeHtml(line)),
    );
  }

  if (why.priceActionLines.length) {
    lines.push(
      '',
      formatSectionHeader(
        actionScenario,
        'Price action',
        why.action === 'PE-BUY' ? '📉' : '📈',
      ),
      ...why.priceActionLines.slice(0, 2).map((line) => escapeHtml(line)),
    );
  }

  if (why.optionFlowLines.length) {
    lines.push(
      '',
      formatSectionHeader('info', 'Option flow', '🌊'),
      ...why.optionFlowLines.slice(0, 2).map((line) => escapeHtml(line)),
    );
  }

  if (why.vetoOrCaution.length) {
    lines.push(
      '',
      wrapScenarioCallout('warning', '<b>⚠️ Caution</b>', [
        ...why.vetoOrCaution.slice(0, 2).map((line) => escapeHtml(line)),
      ]),
    );
  }

  if (exactStrike) {
    lines.push('', formatEnginePickCallout(exactStrike, '<b>STRIKE</b>'));
  }

  if (adaptive) {
    lines.push('', `📈 ${escapeHtml(adaptive.summary)}`);
  }

  lines.push('', `🧠 ${escapeHtml(why.humanSummary)}`);

  return lines.filter((line) => line != null).join('\n');
}