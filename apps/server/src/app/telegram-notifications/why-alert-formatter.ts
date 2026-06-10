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
    ? `Why alert · ${label} · ${why.tradingStyle}`
    : `Signal read · ${label} · ${why.tradingStyle}`;
  const timeLabel = isAlert ? 'Alerted' : 'As of';

  const lines: string[] = [
    `🔍 <b>${escapeHtml(title)}</b>`,
    TELEGRAM_MSG_RULE,
    `${why.action} · ${why.conviction}% conviction · ${escapeHtml(why.bias)}`,
    `🕐 ${timeLabel}: ${new Date(why.alertedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`,
  ];

  if (!isAlert) {
    lines.push(
      'ℹ️ No Telegram alert was sent for this — showing latest engine state.',
    );
  }

  if (why.action === 'NO-TRADE' || why.action === 'NEUTRAL') {
    lines.push(
      '⏸ No directional recommendation — strike pick and paper tracking do not apply.',
    );
  }

  lines.push('', '🧠 <b>Conviction breakdown</b>');
  lines.push(...why.confluenceLines.map((line) => `• ${escapeHtml(line)}`));
  lines.push('', '📊 <b>Price action</b>');
  if (why.priceActionLines.length) {
    lines.push(
      ...why.priceActionLines
        .slice(0, 4)
        .map((line) => `• ${escapeHtml(line)}`),
    );
  } else {
    lines.push('• No detailed PA breakdown stored.');
  }
  lines.push('', '🌊 <b>Option flow (weakest links)</b>');
  if (why.optionFlowLines.length) {
    lines.push(...why.optionFlowLines.map((line) => `• ${escapeHtml(line)}`));
  } else {
    lines.push('• Option flow detail not stored for this read.');
  }

  if (why.vetoOrCaution.length) {
    lines.push('', '⚠️ <b>Caution</b>');
    lines.push(...why.vetoOrCaution.map((line) => `• ${escapeHtml(line)}`));
  }

  if (exactStrike) {
    lines.push('', '🎯 <b>Exact strike pick</b>');
    lines.push(`<code>${escapeHtml(exactStrike.fyersSymbol)}</code>`);
    lines.push(
      `${exactStrike.moneyness} @ ${exactStrike.strike.toLocaleString('en-IN')} · prem ₹${exactStrike.premium.toFixed(1)} · Δ ${exactStrike.delta?.toFixed(2) ?? '—'}`,
    );
    if (exactStrike.expectedPremiumMove50Pts != null) {
      lines.push(
        `↳ ~₹${exactStrike.expectedPremiumMove50Pts.toFixed(1)} premium change per 50 pts spot (per unit)`,
      );
    }
    lines.push(`↳ ${escapeHtml(exactStrike.rationale)}`);
  }

  if (adaptive) {
    lines.push('', '📈 <b>Adaptive conviction</b>', escapeHtml(adaptive.summary));
    const bucketLines = adaptive.buckets
      .filter((b) => b.samples > 0)
      .map((b) => `• ${b.rangeLabel}: ${b.winRate}% win (${b.samples} alerts)`);
    if (bucketLines.length) {
      lines.push(...bucketLines);
    }
  }

  lines.push(
    '',
    '📝 <b>Summary</b>',
    escapeHtml(why.humanSummary),
  );

  if (why.tradeGuidanceNotes) {
    lines.push('', escapeHtml(why.tradeGuidanceNotes));
  }

  return lines.filter((line) => line != null).join('\n');
}