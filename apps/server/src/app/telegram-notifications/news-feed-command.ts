import { MARKET_NEWS_FEEDS } from '../constants/market-news';
import { MarketNewsFeedId } from '../types/market-news-feed';
import { getNewsFeedOption } from './news-feed-preference';
import { joinTelegramLines, joinTelegramSections } from './message-layout';

export function parseNewsFeedCommandArgs(text: string): {
  action: 'status' | MarketNewsFeedId;
} {
  const parts = text.trim().toLowerCase().split(/\s+/);
  const arg = parts[1];

  if (!arg || arg === 'status') return { action: 'status' };
  if (arg === 'google' || arg === 'multi' || arg === 'aggregator') {
    return { action: 'google' };
  }
  if (arg === 'cnbc' || arg === 'cnbctv18' || arg === 'cnbctv-18') {
    return { action: 'cnbc' };
  }

  return { action: 'status' };
}

export function formatNewsFeedStatusMessage(feedId: MarketNewsFeedId): string {
  const active = getNewsFeedOption(feedId);

  const optionLines = Object.values(MARKET_NEWS_FEEDS).map((feed) => {
    const marker = feed.id === active.id ? '✅' : '▫️';
    return `${marker} <b>${feed.label}</b> — ${feed.description}`;
  });

  return joinTelegramSections(
    '📰 <b>News feed</b>',
    joinTelegramLines(
      `Current: <b>${active.label}</b>`,
      active.description,
      '',
      ...optionLines,
    ),
    joinTelegramLines(
      '<code>/newsfeed google</code> — multi-source macro (Mint, ET, Reuters…)',
      '<code>/newsfeed cnbc</code> — CNBC-TV18 economy desk',
      '<code>/newsfeed status</code> — show current feed',
      '',
      '<i>/news uses whichever feed is active here.</i>',
    ),
  );
}