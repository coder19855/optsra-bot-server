import { AlertWhyContext } from '../types/alert-intelligence';
import { AdaptiveConvictionInsight } from '../types/adaptive-conviction';
import { ExactStrikeRecommendation } from '../types/exact-strike-recommendation';
import { TELEGRAM_MSG_RULE } from './message-layout';

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

  const isAlert = why.wasNotified === true || why.source === 'alert';
  const title = isAlert
    ? `🔍 Why that alert fired · ${label} · ${why.tradingStyle}`
    : `🔍 Live read · ${label} · ${why.tradingStyle}`;
  const timeLabel = isAlert ? 'Pinged you at' : 'Snapshot at';

  const lines: string[] = [
    `<b>${escapeHtml(title)}</b>`,
    TELEGRAM_MSG_RULE,
    `${why.action} · ${why.conviction}% conviction · ${escapeHtml(why.bias)}`,
    `🕐 ${timeLabel}: ${new Date(why.alertedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`,
  ];

  if (!isAlert) {
    lines.push(
      'ℹ️ No alert went out for this — just showing what the engine sees right now.',
    );
  }

  if (why.action === 'NO-TRADE' || why.action === 'NEUTRAL') {
    lines.push(
      '⏸ Sidelines mode — no strike pick or paper tracking for this read.',
    );
  }

  lines.push('', '🧠 <b>How conviction stacked up</b>');
  lines.push(...why.confluenceLines.map((line) => `• ${escapeHtml(line)}`));
  lines.push('', '📊 <b>What price action said</b>');
  if (why.priceActionLines.length) {
    lines.push(
      ...why.priceActionLines
        .slice(0, 4)
        .map((line) => `• ${escapeHtml(line)}`),
    );
  } else {
    lines.push('• PA detail wasn’t stored for this one.');
  }
  lines.push('', '🌊 <b>Where option flow wobbled</b>');
  if (why.optionFlowLines.length) {
    lines.push(...why.optionFlowLines.map((line) => `• ${escapeHtml(line)}`));
  } else {
    lines.push('• Option flow didn’t leave breadcrumbs on this read.');
  }

  if (why.vetoOrCaution.length) {
    lines.push('', '⚠️ <b>Heads up</b>');
    lines.push(...why.vetoOrCaution.map((line) => `• ${escapeHtml(line)}`));
  }

  if (exactStrike) {
    lines.push('', '🎯 <b>Strike ticket</b>');
    lines.push(`<code>${escapeHtml(exactStrike.fyersSymbol)}</code>`);
    lines.push(
      `${exactStrike.moneyness} @ ${exactStrike.strike.toLocaleString('en-IN')} · prem ₹${exactStrike.premium.toFixed(1)} · Δ ${exactStrike.delta?.toFixed(2) ?? '—'}`,
    );
    if (exactStrike.expectedPremiumMove50Pts != null) {
      lines.push(
        `↳ ~₹${exactStrike.expectedPremiumMove50Pts.toFixed(1)} premium per 50 pts spot move (per unit)`,
      );
    }
    lines.push(`↳ ${escapeHtml(exactStrike.rationale)}`);
  }

  if (adaptive) {
    lines.push('', '📈 <b>Your personal enter bar</b>', escapeHtml(adaptive.summary));
    const bucketLines = adaptive.buckets
      .filter((b) => b.samples > 0)
      .map((b) => `• ${b.rangeLabel}% bucket: ${b.winRate}% wins (${b.samples} alerts)`);
    if (bucketLines.length) {
      lines.push(...bucketLines);
    }
  }

  lines.push(
    '',
    '📝 <b>Bottom line</b>',
    escapeHtml(why.humanSummary),
  );

  if (why.tradeGuidanceNotes) {
    lines.push('', `💬 ${escapeHtml(why.tradeGuidanceNotes)}`);
  }

  return lines.filter((line) => line != null).join('\n');
}