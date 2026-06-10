import axios from 'axios';

export interface MarketNewsHeadline {
  title: string;
  source: string | null;
  publishedAt: string | null;
  url: string | null;
}

const DEFAULT_NEWS_RSS =
  'https://news.google.com/rss/search?q=India+stock+market+NIFTY+OR+RBI+OR+inflation+OR+crude&hl=en-IN&gl=IN&ceid=IN:en';

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
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
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

export function isMarketNewsEnabled(): boolean {
  return (
    (process.env.TELEGRAM_MARKET_NEWS_ENABLED ?? 'true').toLowerCase() !== 'false'
  );
}

export async function fetchMarketNewsHeadlines(
  limit = 5,
): Promise<MarketNewsHeadline[]> {
  const rssUrl = process.env.TELEGRAM_MARKET_NEWS_RSS_URL?.trim() || DEFAULT_NEWS_RSS;

  try {
    const res = await axios.get<string>(rssUrl, {
      timeout: 12_000,
      responseType: 'text',
      headers: { 'User-Agent': 'opstra-bot/1.0' },
    });

    const xml = res.data ?? '';
    const items = xml.match(/<item[\s\S]*?<\/item>/gi) ?? [];
    const headlines: MarketNewsHeadline[] = [];

    for (const item of items.slice(0, limit)) {
      const rawTitle = extractTag(item, 'title');
      if (!rawTitle) continue;

      const { title, source } = parseSourceFromTitle(rawTitle);
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