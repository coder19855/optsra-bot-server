import { getNewsFeedOption } from './news-feed-preference';
import { MarketNewsHeadline } from './market-news';
import { MarketNewsFeedId } from '../types/market-news-feed';
import { DEFAULT_TELEGRAM_VOICE, TelegramVoice } from '../types/telegram-voice';
import { joinTelegramLines, joinTelegramSections } from './message-layout';
import { wrapScenarioCallout } from './telegram-palette';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatPublishedLabel(publishedAt: string | null): string | null {
  if (!publishedAt) return null;
  const ms = Date.parse(publishedAt);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    day: 'numeric',
    month: 'short',
  });
}

export function formatMarketNewsHeadlineLine(item: MarketNewsHeadline): string {
  const title = escapeHtml(item.title);
  const source = item.source ? ` <i>(${escapeHtml(item.source)})</i>` : '';
  const timeLabel = formatPublishedLabel(item.publishedAt);
  const time = timeLabel ? ` · <i>${escapeHtml(timeLabel)} IST</i>` : '';

  if (item.url) {
    const href = escapeHtml(item.url);
    return `• <a href="${href}">${title}</a>${source}${time}`;
  }

  return `• ${title}${source}${time}`;
}

export function formatMarketNewsSection(
  headlines: MarketNewsHeadline[],
  title = 'Headlines',
  maxItems = 3,
): string | null {
  if (!headlines.length) return null;

  const lines = headlines
    .slice(0, maxItems)
    .map((item) => formatMarketNewsHeadlineLine(item));

  return wrapScenarioCallout('info', `<b>📰 ${escapeHtml(title)}</b>`, lines);
}

export function formatNewsTelegramMessage(
  headlines: MarketNewsHeadline[],
  feedId: MarketNewsFeedId,
  voice: TelegramVoice = DEFAULT_TELEGRAM_VOICE,
): string {
  const feed = getNewsFeedOption(feedId);
  const asOf = new Date().toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    day: 'numeric',
    month: 'short',
  });

  const header = joinTelegramLines(
    '📰 <b>Market headlines</b>',
    `<i>${escapeHtml(feed.headerSubtitle)} · ${escapeHtml(asOf)} IST</i>`,
    `<i>${escapeHtml(feed.linkHint)}</i>`,
  );

  const body = wrapScenarioCallout(
    'info',
    '<b>Latest</b>',
    headlines.map((item) => formatMarketNewsHeadlineLine(item)),
  );

  const footer =
    voice === 'tapori'
      ? '<i>Macro mood check before size maar — RBI, crude, global cues.</i>'
      : '<i>Macro context for NIFTY — RBI, inflation, crude, global risk.</i>';

  return joinTelegramSections(header, body, footer);
}