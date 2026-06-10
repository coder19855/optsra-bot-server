import { AlertWhyContext } from '../types/alert-intelligence';
import { AdaptiveConvictionInsight } from '../types/adaptive-conviction';
import { ExactStrikeRecommendation } from '../types/exact-strike-recommendation';
import { scenarioRule } from './message-layout';
import { formatEnginePickCallout } from './strike-callouts';
import {
  formatScenarioBanner,
  formatSectionHeader,
  scenarioForAction,
  tintLine,
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
  const headline = isAlert
    ? `Why that alert fired · ${label} · ${why.tradingStyle}`
    : `Live read · ${label} · ${why.tradingStyle}`;
  const timeLabel = isAlert ? 'Pinged you at' : 'Snapshot at';

  const lines: string[] = [
    formatScenarioBanner('info', headline),
    scenarioRule(actionScenario),
    tintLine(
      actionScenario,
      `${why.action} · ${why.conviction}% conviction · ${escapeHtml(why.bias)}`,
    ),
    tintLine(
      'info',
      `🕐 ${timeLabel}: ${new Date(why.alertedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`,
    ),
  ];

  if (!isAlert) {
    lines.push(
      tintLine('info', 'No alert went out — showing what the engine sees right now.'),
    );
  }

  if (why.action === 'NO-TRADE' || why.action === 'NEUTRAL') {
    lines.push(
      tintLine('neutral', 'Sidelines mode — no strike pick or paper tracking.'),
    );
  }

  lines.push(
    '',
    formatSectionHeader('learning', 'How conviction stacked up', '📊'),
    ...why.confluenceLines.map((line) => tintLine('learning', escapeHtml(line))),
    '',
    formatSectionHeader(
      actionScenario,
      'What price action said',
      why.action === 'PE-BUY' ? '📉' : '📈',
    ),
  );
  if (why.priceActionLines.length) {
    lines.push(
      ...why.priceActionLines
        .slice(0, 4)
        .map((line) => tintLine(actionScenario, escapeHtml(line))),
    );
  } else {
    lines.push(tintLine('muted', 'PA detail wasn’t stored for this one.'));
  }

  lines.push('', formatSectionHeader('info', 'Where option flow wobbled', '🌊'));
  if (why.optionFlowLines.length) {
    lines.push(...why.optionFlowLines.map((line) => tintLine('info', escapeHtml(line))));
  } else {
    lines.push(tintLine('muted', 'Option flow didn’t leave breadcrumbs on this read.'));
  }

  if (why.vetoOrCaution.length) {
    lines.push(
      '',
      wrapScenarioCallout('warning', '<b>⚠️ Heads up</b>', [
        ...why.vetoOrCaution.map((line) => tintLine('warning', escapeHtml(line))),
      ]),
    );
  }

  if (exactStrike) {
    lines.push('', formatEnginePickCallout(exactStrike, '<b>STRIKE TICKET</b>'));
  }

  if (adaptive) {
    lines.push(
      '',
      wrapScenarioCallout('success', '<b>📈 Your personal enter bar</b>', [
        escapeHtml(adaptive.summary),
        ...adaptive.buckets
          .filter((b) => b.samples > 0)
          .map((b) =>
            tintLine(
              'success',
              `${b.rangeLabel}% bucket: ${b.winRate}% wins (${b.samples} alerts)`,
            ),
          ),
      ]),
    );
  }

  lines.push(
    '',
    wrapScenarioCallout(actionScenario, '<b>💬 Bottom line</b>', [
      escapeHtml(why.humanSummary),
    ]),
  );

  if (why.tradeGuidanceNotes) {
    lines.push('', tintLine('info', escapeHtml(why.tradeGuidanceNotes)));
  }

  return lines.filter((line) => line != null).join('\n');
}