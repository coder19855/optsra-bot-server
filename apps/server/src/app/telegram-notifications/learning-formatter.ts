import { MarketNewsHeadline } from './market-news';
import { LearningInsightProfile } from './learning-insights';
import {
  formatScenarioBanner,
  paletteToken,
  wrapScenarioCallout,
} from './telegram-palette';

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
  scenario: 'warning' | 'success',
): string {
  if (!items.length) return emptyLabel;
  return items
    .map(
      (item) =>
        `${paletteToken(scenario).accent} <b>${escapeHtml(item.label)}</b> ×${item.count} — ${escapeHtml(item.reminder)}`,
    )
    .join('\n');
}

export function formatMarketNewsSection(headlines: MarketNewsHeadline[]): string | null {
  if (!headlines.length) return null;

  const lines = headlines.slice(0, 3).map((item) => {
    const source = item.source ? ` (${escapeHtml(item.source)})` : '';
    return `• ${escapeHtml(item.title)}${source}`;
  });

  return wrapScenarioCallout('info', '<b>📰 Headlines</b>', lines);
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

  const tradeSummary =
    profile.totalTrades > 0
      ? `${profile.lookbackDays}d · ${profile.totalTrades} trades · ✅${profile.verdicts.good} ⚠️${profile.verdicts.bad} 🚨${profile.verdicts.ugly}`
      : `${profile.lookbackDays}d · no closed trades yet`;

  const sections = [
    preamble
      ? formatScenarioBanner('learning', '🌅 Pre-session brief')
      : formatScenarioBanner('learning', 'Your trade lessons'),
    `📅 ${dateLabel} · ${tradeSummary}`,
    '',
    wrapScenarioCallout('warning', '<b>🕳️ Leaks</b>', [
      formatPatterns(
        profile.leaks,
        'No repeat leaks tagged.',
        'warning',
      ),
    ]),
    '',
    wrapScenarioCallout('success', '<b>💪 Strengths</b>', [
      formatPatterns(
        profile.strengths,
        'Keep taking engine-approved entries.',
        'success',
      ),
    ]),
    '',
    wrapScenarioCallout('pick', '<b>🎯 Today</b>', [
      escapeHtml(profile.intention),
    ]),
  ];

  if (profile.recentMistakeNotes.length) {
    sections.push(
      '',
      wrapScenarioCallout('danger', '<b>📝 Reminders</b>', [
        ...profile.recentMistakeNotes
          .slice(0, 2)
          .map((note) => escapeHtml(note)),
      ]),
    );
  }

  if (params.includeNews) {
    const newsBlock = formatMarketNewsSection(params.newsHeadlines ?? []);
    if (newsBlock) sections.push('', newsBlock);
  }

  if (preamble) {
    sections.push('', 'Full detail: <code>/learning</code>');
  }

  const body = sections.join('\n');
  if (body.length <= 3900) return body;
  return `${body.slice(0, 3850)}\n\n… trimmed`;
}