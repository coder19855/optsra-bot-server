import axios from 'axios';
import {
  MARKET_NEWS_DEFAULTS,
  MARKET_NEWS_FEEDS,
} from '../constants/market-news';
import { MarketNewsFeedId } from '../types/market-news-feed';

export interface MarketNewsHeadline {
  title: string;
  source: string | null;
  publishedAt: string | null;
  url: string | null;
}

function decodeXml(text: string): string {
  return text
    .replace(/<!\[CDATA\[/g, '')
    .replace(/\]\]>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function extractTag(block: string, tag: string): string | null {
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = block.match(
    new RegExp(`<${escapedTag}[^>]*>([\\s\\S]*?)</${escapedTag}>`, 'i'),
  );
  return match ? decodeXml(match[1]) : null;
}

function parseSourceFromTitle(title: string): { title: string; source: string | null } {
  const dash = title.lastIndexOf(' - ');
  if (dash <= 0) return { title, source: null };
  return {
    title: title.slice(0, dash).trim(),
    source: title.slice(dash + 3).trim() || null,
  };
}

export function isCnbctv18FeedUrl(url: string): boolean {
  return url.toLowerCase().includes('cnbctv18.com');
}

export function resolveMarketNewsRssUrl(
  feedId: MarketNewsFeedId = MARKET_NEWS_DEFAULTS.DEFAULT_FEED_ID,
): string {
  const envOverride = process.env.TELEGRAM_MARKET_NEWS_RSS_URL?.trim();
  if (envOverride) return envOverride;
  return MARKET_NEWS_FEEDS[feedId].url;
}

export function isMarketNewsEnabled(): boolean {
  return (
    (process.env.TELEGRAM_MARKET_NEWS_ENABLED ?? 'true').toLowerCase() !== 'false'
  );
}

export function resolveHeadlineSource(
  item: string,
  rawTitle: string,
  feedUrl: string,
): { title: string; source: string | null } {
  const { title, source: titleSource } = parseSourceFromTitle(rawTitle);

  if (isCnbctv18FeedUrl(feedUrl)) {
    const byline = extractTag(item, 'dc:creator');
    const label = MARKET_NEWS_DEFAULTS.SOURCE_LABEL;
    return {
      title,
      source: byline ? `${label} · ${byline}` : label,
    };
  }

  return { title, source: titleSource };
}

export async function fetchMarketNewsHeadlines(
  limit = 5,
  feedId: MarketNewsFeedId = MARKET_NEWS_DEFAULTS.DEFAULT_FEED_ID,
): Promise<MarketNewsHeadline[]> {
  const rssUrl = resolveMarketNewsRssUrl(feedId);

  try {
    const res = await axios.get<string>(rssUrl, {
      timeout: 12_000,
      responseType: 'text',
      headers: { 'User-Agent': 'optra-pulse-bot/1.0' },
    });

    const xml = res.data ?? '';
    const items = xml.match(/<item[\s\S]*?<\/item>/gi) ?? [];
    const headlines: MarketNewsHeadline[] = [];

    for (const item of items.slice(0, limit)) {
      const rawTitle = extractTag(item, 'title');
      if (!rawTitle) continue;

      const { title, source } = resolveHeadlineSource(item, rawTitle, rssUrl);
      headlines.push({
        title,
        source,
        publishedAt: extractTag(item, 'pubDate'),
        url: extractTag(item, 'link'),
      });
    }

    return headlines;
  } catch {
    return [];
  }
}