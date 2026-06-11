import { MarketNewsHeadline } from './market-news';
import { formatMarketNewsSection as formatLinkedMarketNewsSection } from './market-news-formatter';
import { LearningInsightProfile } from './learning-insights';
import { DEFAULT_TELEGRAM_VOICE, TelegramVoice } from '../types/telegram-voice';
import { joinTelegramLines, joinTelegramSections } from './message-layout';
import {
  uiLearningEmptyLeaks,
  uiLearningEmptyStrengths,
  uiLearningFooter,
  uiLearningHeadlinesTitle,
  uiLearningLeaksTitle,
  uiLearningBanner,
  uiLearningRemindersTitle,
  uiLearningStrengthsTitle,
  uiLearningTodayTitle,
  uiLearningTradeSummary,
} from './voice-ui-copy';
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

export function formatLearningTelegramMessage(params: {
  profile: LearningInsightProfile;
  sessionDate: string;
  preamble?: boolean;
  newsHeadlines?: MarketNewsHeadline[];
  includeNews?: boolean;
  voice?: TelegramVoice;
}): string {
  const { profile, sessionDate, preamble, voice = DEFAULT_TELEGRAM_VOICE } = params;
  const dateLabel = formatIstDateLabel(sessionDate);

  const tradeSummary = uiLearningTradeSummary({
    lookbackDays: profile.lookbackDays,
    totalTrades: profile.totalTrades,
    verdicts: profile.verdicts,
    voice,
  });

  const header = joinTelegramLines(
    formatScenarioBanner('learning', uiLearningBanner(Boolean(preamble), voice)),
    `📅 ${dateLabel} · ${tradeSummary}`,
  );

  const leaksBlock = wrapScenarioCallout('warning', `<b>🕳️ ${uiLearningLeaksTitle(voice)}</b>`, [
    formatPatterns(profile.leaks, uiLearningEmptyLeaks(voice), 'warning'),
  ]);

  const strengthsBlock = wrapScenarioCallout('success', `<b>💪 ${uiLearningStrengthsTitle(voice)}</b>`, [
    formatPatterns(
      profile.strengths,
      uiLearningEmptyStrengths(voice),
      'success',
    ),
  ]);

  const todayBlock = wrapScenarioCallout('pick', `<b>🎯 ${uiLearningTodayTitle(voice)}</b>`, [
    escapeHtml(profile.intention),
  ]);

  const remindersBlock =
    profile.recentMistakeNotes.length > 0
      ? wrapScenarioCallout('danger', `<b>📝 ${uiLearningRemindersTitle(voice)}</b>`, [
          ...profile.recentMistakeNotes
            .slice(0, 2)
            .map((note) => escapeHtml(note)),
        ])
      : null;

  const newsBlock = params.includeNews
    ? formatLinkedMarketNewsSection(
        params.newsHeadlines ?? [],
        uiLearningHeadlinesTitle(voice),
        3,
      )
    : null;

  const footerBlock = preamble ? uiLearningFooter(voice) : null;

  const body = joinTelegramSections(
    header,
    leaksBlock,
    strengthsBlock,
    todayBlock,
    remindersBlock,
    newsBlock,
    footerBlock,
  );

  if (body.length <= 3900) return body;
  return `${body.slice(0, 3850)}\n\n… trimmed`;
}