import {
  PositionTpEvaluation,
  TpAlertKind,
} from '../types/telegram-notifications';
import {
  formatScenarioBanner,
  scenarioForHoldAdvice,
  scenarioForPnl,
  scenarioForTpKinds,
  wrapScenarioCallout,
} from './telegram-palette';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function kindHeadline(kinds: TpAlertKind[]): string {
  if (kinds.includes('SIGNAL_CONFLICT')) return '⚔️ Position vs engine';
  if (kinds.includes('REACHED')) return '🎉 Target hit';
  if (kinds.includes('APPROACHING')) return '👀 Target near';
  return '🧭 Hold check';
}

function formatRrSummary(evaluation: PositionTpEvaluation): string {
  const parts = [
    `${evaluation.currentR.toFixed(2)}R`,
    `spot ${evaluation.spot.toLocaleString('en-IN')}`,
    `entry ${evaluation.tradeSetup.entry.toLocaleString('en-IN')}`,
    `SL ${evaluation.tradeSetup.stopLoss.toLocaleString('en-IN')}`,
  ];

  if (evaluation.highestHitTp) {
    parts.push(`banked ${evaluation.highestHitTp.rr}`);
  }

  if (evaluation.nextTp) {
    const dist =
      evaluation.distanceToNextPoints != null
        ? `${evaluation.distanceToNextPoints.toFixed(0)}pts`
        : '';
    parts.push(`next ${evaluation.nextTp.rr} ${dist}`.trim());
  }

  return parts.join(' · ');
}

export function formatTelegramTpAlertMessage(params: {
  evaluation: PositionTpEvaluation;
  kinds: TpAlertKind[];
}): string {
  const { evaluation, kinds } = params;
  const { position } = evaluation;
  const pnlSign = position.unrealizedPnl >= 0 ? '+' : '';
  const tpScenario = scenarioForTpKinds(kinds);
  const holdScenario = scenarioForHoldAdvice(evaluation.holdAdvice);
  const pnlScenario = scenarioForPnl(position.unrealizedPnl);

  const reasons = evaluation.holdReasons
    .slice(0, 2)
    .map((line) => escapeHtml(line))
    .join('\n');

  return [
    formatScenarioBanner(tpScenario, kindHeadline(kinds)),
    `<b>${escapeHtml(position.optionLabel)}</b> · ${escapeHtml(position.indexLabel)} · ${evaluation.tradingStyle}`,
    `${pnlScenario === 'success' ? '✅' : pnlScenario === 'danger' ? '🚨' : '⚠️'} P&L ${pnlSign}₹${Math.abs(position.unrealizedPnl).toLocaleString('en-IN', { maximumFractionDigits: 0 })} · ${position.netQty} qty @ ₹${position.buyAvg.toFixed(1)}`,
    `Engine: ${evaluation.signalAction} ${evaluation.conviction}% · ${escapeHtml(evaluation.bias)}`,
    formatRrSummary(evaluation),
    wrapScenarioCallout(holdScenario, '<b>🧭 Coach</b>', [
      escapeHtml(evaluation.holdHeadline),
      reasons || null,
    ].filter((line): line is string => line != null)),
  ]
    .filter((line) => line != null)
    .join('\n');
}