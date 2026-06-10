import { MarketNewsHeadline } from './market-news';
import { LearningInsightProfile } from './learning-insights';
import { scenarioRule } from './message-layout';
import {
  formatScenarioBanner,
  paletteToken,
  tintLine,
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
  if (!items.length) return tintLine(scenario, emptyLabel.replace(/^•\s*/, ''));
  return items
    .map(
      (item) =>
        `${paletteToken(scenario).accent} <b>${escapeHtml(item.label)}</b> ×${item.count}\n   ↳ ${escapeHtml(item.reminder)}`,
    )
    .join('\n');
}

export function formatMarketNewsSection(headlines: MarketNewsHeadline[]): string | null {
  if (!headlines.length) {
    return wrapScenarioCallout('info', '<b>📰 Market mood</b>', [
      '📭 Headlines MIA — peek at NSE / economic calendar before you size up.',
    ]);
  }

  const lines = headlines.slice(0, 5).map((item) => {
    const source = item.source ? ` · ${escapeHtml(item.source)}` : '';
    return tintLine('info', `${escapeHtml(item.title)}${source}`);
  });

  return wrapScenarioCallout('info', '<b>📰 What the tape is whispering</b>', lines);
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
      ? `Last ${profile.lookbackDays} days · ${profile.totalTrades} coached trades · ✅ ${profile.verdicts.good} · ⚠️ ${profile.verdicts.bad} · 🚨 ${profile.verdicts.ugly}`
      : `Last ${profile.lookbackDays} days · no closed trades yet — fresh slate today.`;

  const sections = [
    preamble
      ? formatScenarioBanner('learning', '🌅 Before the bell — your homework')
      : formatScenarioBanner('learning', 'Lessons from your own trades'),
    tintLine('info', `📅 ${dateLabel}`),
    scenarioRule('learning'),
    tradeSummary,
    '',
    wrapScenarioCallout('warning', '<b>🕳️ Leaks that keep biting you</b>', [
      formatPatterns(
        profile.leaks,
        'No repeat offenders tagged — stay sharp anyway; one bad hour can cluster.',
        'warning',
      ),
    ]),
    '',
    wrapScenarioCallout('success', '<b>💪 Habits worth keeping</b>', [
      formatPatterns(
        profile.strengths,
        'Not enough green patterns yet — stick to engine-approved entries only.',
        'success',
      ),
    ]),
    '',
    wrapScenarioCallout('pick', '<b>🎯 One intention for today</b>', [
      escapeHtml(profile.intention),
    ]),
  ];

  if (profile.recentMistakeNotes.length) {
    sections.push(
      '',
      wrapScenarioCallout('danger', '<b>📝 Fresh reminders from ugly trades</b>', [
        ...profile.recentMistakeNotes
          .slice(0, 3)
          .map((note) => tintLine('danger', escapeHtml(note))),
      ]),
    );
  }

  if (params.includeNews) {
    const newsBlock = formatMarketNewsSection(params.newsHeadlines ?? []);
    if (newsBlock) {
      sections.push('', newsBlock);
    }
  }

  if (preamble) {
    sections.push('', tintLine('info', 'Want the full breakdown? <code>/learning</code>'));
  } else {
    sections.push(
      '',
      tintLine(
        'muted',
        'Pulled from your Fyers book + engine replay — not random guru quotes.',
      ),
    );
  }

  const body = sections.join('\n');
  if (body.length <= 3900) return body;
  return `${body.slice(0, 3850)}\n\n… trimmed for Telegram`;
}