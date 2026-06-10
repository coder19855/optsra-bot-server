import {
  PositionTpEvaluation,
  TpAlertKind,
  TpHoldAdvice,
} from '../types/telegram-notifications';
import { TELEGRAM_MSG_RULE } from './message-layout';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function adviceEmoji(advice: TpHoldAdvice): string {
  if (advice === 'hold') return '🟢';
  if (advice === 'trail') return '🟡';
  if (advice === 'partial') return '🟠';
  return '🔴';
}

function kindBanner(kinds: TpAlertKind[]): string {
  if (kinds.includes('SIGNAL_CONFLICT')) {
    return '⚠️ <b>Your position vs the engine</b>';
  }
  if (kinds.includes('REACHED')) {
    return '🎯 <b>Target hit — nice!</b>';
  }
  if (kinds.includes('APPROACHING')) {
    return '🎯 <b>Target in sight</b>';
  }
  return '🎯 <b>Hold check</b>';
}

function formatRrLine(evaluation: PositionTpEvaluation): string {
  const parts: string[] = [
    `📈 <b>Riding:</b> ${evaluation.currentR.toFixed(2)}R on index`,
    `💰 <b>Spot:</b> ${evaluation.spot.toLocaleString('en-IN')}`,
    `🎯 <b>Entry:</b> ${evaluation.tradeSetup.entry.toLocaleString('en-IN')}`,
    `🛑 <b>Stop:</b> ${evaluation.tradeSetup.stopLoss.toLocaleString('en-IN')} (${evaluation.tradeSetup.risk.toFixed(1)} pts risk)`,
  ];

  if (evaluation.highestHitTp) {
    parts.push(
      `✅ <b>Banked:</b> ${evaluation.highestHitTp.rr} @ ${evaluation.highestHitTp.price.toLocaleString('en-IN')}`,
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
      `⏭ <b>Next prize:</b> ${evaluation.nextTp.rr} @ ${evaluation.nextTp.price.toLocaleString('en-IN')} · ${dist}${distR}`,
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
  const banner = kindBanner(kinds);
  const advice = adviceEmoji(evaluation.holdAdvice);

  const reasons = evaluation.holdReasons
    .slice(0, 4)
    .map((line) => `   • ${escapeHtml(line)}`)
    .join('\n');

  return [
    banner,
    `<b>${escapeHtml(position.optionLabel)}</b> · ${escapeHtml(position.indexLabel)} · ${evaluation.tradingStyle}`,
    TELEGRAM_MSG_RULE,
    `📦 <b>Size:</b> ${position.netQty} · avg prem ₹${position.buyAvg.toFixed(1)}`,
    `${pnlSign.startsWith('+') ? '🟢' : '🔴'} <b>Open P&amp;L:</b> ${pnlSign}₹${Math.abs(position.unrealizedPnl).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`,
    `🧭 <b>Engine says:</b> ${evaluation.signalAction} · ${evaluation.conviction}% conviction · ${escapeHtml(evaluation.bias)}`,
    TELEGRAM_MSG_RULE,
    formatRrLine(evaluation),
    TELEGRAM_MSG_RULE,
    `${advice} <b>Coach says:</b> ${escapeHtml(evaluation.holdHeadline)}`,
    reasons ? `💡 <b>Why</b>\n${reasons}` : null,
    TELEGRAM_MSG_RULE,
    '📌 TP levels track live — trail as spot moves in your favour.',
  ]
    .filter((line) => line != null)
    .join('\n');
}