import {
  PositionTpEvaluation,
  TpAlertKind,
  TpHoldAdvice,
} from '../types/telegram-notifications';

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
    return '⚠️🔄 POSITION vs SIGNAL CONFLICT 🔄⚠️';
  }
  if (kinds.includes('REACHED')) {
    return '🎯✅ TAKE PROFIT LEVEL REACHED ✅🎯';
  }
  if (kinds.includes('APPROACHING')) {
    return '🎯📍 APPROACHING TAKE PROFIT 📍🎯';
  }
  return '🎯📊 POSITION HOLD REVIEW 📊🎯';
}

function formatRrLine(evaluation: PositionTpEvaluation): string {
  const parts: string[] = [
    `📈 <b>Current:</b> ${evaluation.currentR.toFixed(2)}R on index`,
    `💰 <b>Spot:</b> ${evaluation.spot.toLocaleString('en-IN')}`,
    `🎯 <b>Entry:</b> ${evaluation.tradeSetup.entry.toLocaleString('en-IN')}`,
    `🛑 <b>Stop:</b> ${evaluation.tradeSetup.stopLoss.toLocaleString('en-IN')} (${evaluation.tradeSetup.risk.toFixed(1)} pts risk)`,
  ];

  if (evaluation.highestHitTp) {
    parts.push(
      `✅ <b>Hit:</b> ${evaluation.highestHitTp.rr} @ ${evaluation.highestHitTp.price.toLocaleString('en-IN')}`,
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
      `⏭ <b>Next:</b> ${evaluation.nextTp.rr} @ ${evaluation.nextTp.price.toLocaleString('en-IN')} · ${dist}${distR}`,
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
    '━━━━━━━━━━━━━━━━━━━━',
    `📦 <b>Qty:</b> ${position.netQty} · premium avg ₹${position.buyAvg.toFixed(1)}`,
    `${pnlSign.startsWith('+') ? '🟢' : '🔴'} <b>Open PnL:</b> ${pnlSign}₹${Math.abs(position.unrealizedPnl).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`,
    `🧭 <b>Engine:</b> ${evaluation.signalAction} · ${evaluation.conviction}% conviction · ${escapeHtml(evaluation.bias)}`,
    '━━━━━━━━━━━━━━━━━━━━',
    formatRrLine(evaluation),
    '━━━━━━━━━━━━━━━━━━━━',
    `${advice} <b>Coach:</b> ${escapeHtml(evaluation.holdHeadline)}`,
    reasons ? `💡 <b>Why</b>\n${reasons}` : null,
    '━━━━━━━━━━━━━━━━━━━━',
    '📌 Index TP levels come from the live engine setup — trail stops as spot moves.',
  ]
    .filter((line) => line != null)
    .join('\n');
}