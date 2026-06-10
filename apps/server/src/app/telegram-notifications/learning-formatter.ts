import { MarketNewsHeadline } from './market-news';
import { LearningInsightProfile } from './learning-insights';
import { TELEGRAM_MSG_RULE } from './message-layout';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatIstDateLabel(sessionDate: string): string {
  const [year, month, day] = sessionDate.split('-');
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  const m = months[Number(month) - 1] ?? month;
  return `${Number(day)} ${m} ${year}`;
}

function formatPatterns(
  items: LearningInsightProfile['leaks'],
  emptyLabel: string,
): string {
  if (!items.length) return emptyLabel;
  return items
    .map(
      (item) =>
        `• <b>${escapeHtml(item.label)}</b> ×${item.count}\n   ↳ ${escapeHtml(item.reminder)}`,
    )
    .join('\n');
}

export function formatMarketNewsSection(headlines: MarketNewsHeadline[]): string | null {
  if (!headlines.length) {
    return '📰 <b>Market mood</b>\n↳ Headlines MIA — peek at NSE / economic calendar before you size up.';
  }

  const lines = headlines.slice(0, 5).map((item) => {
    const source = item.source ? ` · ${escapeHtml(item.source)}` : '';
    return `• ${escapeHtml(item.title)}${source}`;
  });

  return ['📰 <b>What the tape is whispering</b>', ...lines].join('\n');
}

export function formatLearningTelegramMessage(params: {
  profile: LearningInsightProfile;
  sessionDate: string;
  preamble?: boolean;
  newsHeadlines?: MarketNewsHeadline[];
  includeNews?: boolean;
}): string {
  const { profile, sessionDate, preamble } = params;
  const dateLabel = formatIstDateLabel(sessionDate);
  const title = preamble
    ? '🌅 <b>Before the bell — your homework</b>'
    : '🧠 <b>Lessons from your own trades</b>';

  const tradeSummary =
    profile.totalTrades > 0
      ? `Last <b>${profile.lookbackDays} days</b> · <b>${profile.totalTrades}</b> coached trades · ✅ ${profile.verdicts.good} · ⚠️ ${profile.verdicts.bad} · 🚨 ${profile.verdicts.ugly}`
      : `Last <b>${profile.lookbackDays} days</b> · no closed trades to learn from yet — fresh slate today.`;

  const sections = [
    title,
    `📅 ${dateLabel}`,
    TELEGRAM_MSG_RULE,
    tradeSummary,
    '',
    '🕳️ <b>Leaks that keep biting you</b>',
    formatPatterns(
      profile.leaks,
      '• No repeat offenders tagged — stay sharp anyway; one bad hour can cluster.',
    ),
    '',
    '💪 <b>Habits worth keeping</b>',
    formatPatterns(
      profile.strengths,
      '• Not enough green patterns yet — stick to engine-approved entries only.',
    ),
    '',
    '🎯 <b>One intention for today</b>',
    escapeHtml(profile.intention),
  ];

  if (profile.recentMistakeNotes.length) {
    sections.push(
      '',
      '📝 <b>Fresh reminders from ugly trades</b>',
      ...profile.recentMistakeNotes
        .slice(0, 3)
        .map((note) => `• ${escapeHtml(note)}`),
    );
  }

  if (params.includeNews) {
    const newsBlock = formatMarketNewsSection(params.newsHeadlines ?? []);
    if (newsBlock) {
      sections.push('', newsBlock);
    }
  }

  if (preamble) {
    sections.push('', '💬 Want the full breakdown? <code>/learning</code>');
  } else {
    sections.push(
      '',
      '💡 Pulled from <i>your</i> Fyers book + engine replay — not random guru quotes.',
    );
  }

  const body = sections.join('\n');
  if (body.length <= 3900) return body;
  return `${body.slice(0, 3850)}\n\n… trimmed for Telegram`;
}