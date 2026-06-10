import {
  PositionTpEvaluation,
  TpAlertKind,
} from '../types/telegram-notifications';
import { scenarioRule } from './message-layout';
import {
  formatScenarioBanner,
  scenarioForHoldAdvice,
  scenarioForPnl,
  scenarioForTpKinds,
  tintLine,
  wrapScenarioCallout,
} from './telegram-palette';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function kindHeadline(kinds: TpAlertKind[]): string {
  if (kinds.includes('SIGNAL_CONFLICT')) {
    return '⚔️ Your position vs the engine';
  }
  if (kinds.includes('REACHED')) {
    return '🎉 Target hit — nice!';
  }
  if (kinds.includes('APPROACHING')) {
    return '👀 Target in sight';
  }
  return '🧭 Hold check';
}

function formatRrLine(evaluation: PositionTpEvaluation): string {
  const parts: string[] = [
    tintLine('info', `<b>Riding:</b> ${evaluation.currentR.toFixed(2)}R on index`),
    tintLine('info', `<b>Spot:</b> ${evaluation.spot.toLocaleString('en-IN')}`),
    tintLine('info', `<b>Entry:</b> ${evaluation.tradeSetup.entry.toLocaleString('en-IN')}`),
    tintLine(
      'info',
      `<b>Stop:</b> ${evaluation.tradeSetup.stopLoss.toLocaleString('en-IN')} (${evaluation.tradeSetup.risk.toFixed(1)} pts risk)`,
    ),
  ];

  if (evaluation.highestHitTp) {
    parts.push(
      tintLine(
        'success',
        `<b>Banked:</b> ${evaluation.highestHitTp.rr} @ ${evaluation.highestHitTp.price.toLocaleString('en-IN')}`,
      ),
    );
  }

  if (evaluation.nextTp) {
    const dist =
      evaluation.distanceToNextPoints != null
        ? `${evaluation.distanceToNextPoints.toFixed(1)} pts`
        : '—';
    const distR =
      evaluation.distanceToNextR != null
        ? ` (${evaluation.distanceToNextR.toFixed(2)}R away)`
        : '';
    parts.push(
      tintLine(
        'pick',
        `<b>Next prize:</b> ${evaluation.nextTp.rr} @ ${evaluation.nextTp.price.toLocaleString('en-IN')} · ${dist}${distR}`,
      ),
    );
  }

  return parts.join('\n');
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
    .slice(0, 4)
    .map((line) => tintLine(holdScenario, escapeHtml(line)))
    .join('\n');

  return [
    formatScenarioBanner(tpScenario, kindHeadline(kinds)),
    tintLine(
      'info',
      `<b>${escapeHtml(position.optionLabel)}</b> · ${escapeHtml(position.indexLabel)} · ${evaluation.tradingStyle}`,
    ),
    scenarioRule(tpScenario),
    tintLine('info', `<b>Size:</b> ${position.netQty} · avg prem ₹${position.buyAvg.toFixed(1)}`),
    tintLine(
      pnlScenario,
      `<b>Open P&amp;L:</b> ${pnlSign}₹${Math.abs(position.unrealizedPnl).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`,
    ),
    tintLine(
      'info',
      `<b>Engine says:</b> ${evaluation.signalAction} · ${evaluation.conviction}% · ${escapeHtml(evaluation.bias)}`,
    ),
    scenarioRule('info'),
    formatRrLine(evaluation),
    scenarioRule(holdScenario),
    wrapScenarioCallout(holdScenario, '<b>🧭 Coach says</b>', [
      escapeHtml(evaluation.holdHeadline),
      reasons || null,
    ].filter((line): line is string => line != null)),
    '',
    tintLine('muted', 'TP levels track live — trail as spot moves in your favour.'),
  ]
    .filter((line) => line != null)
    .join('\n');
}