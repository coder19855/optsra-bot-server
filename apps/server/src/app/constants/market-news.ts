import { MarketNewsFeedId, MarketNewsFeedOption } from '../types/market-news-feed';

/** CNBC-TV18 section feeds — https://www.cnbctv18.com/rss/ */
export const CNBC_TV18_RSS_FEEDS = {
  market: 'https://www.cnbctv18.com/commonfeeds/v1/cne/rss/market.xml',
  latest: 'https://www.cnbctv18.com/commonfeeds/v1/cne/rss/latest.xml',
  economy: 'https://www.cnbctv18.com/commonfeeds/v1/cne/rss/economy.xml',
  business: 'https://www.cnbctv18.com/commonfeeds/v1/cne/rss/business.xml',
} as const;

export const GOOGLE_NEWS_MACRO_RSS =
  'https://news.google.com/rss/search?q=India+economy+OR+RBI+OR+inflation+OR+crude+OR+NIFTY+OR+stock+market&hl=en-IN&gl=IN&ceid=IN:en';

export const MARKET_NEWS_FEEDS: Record<MarketNewsFeedId, MarketNewsFeedOption> = {
  google: {
    id: 'google',
    label: 'Google News',
    description: 'Multi-source India macro & market headlines (Mint, ET, Reuters, etc.)',
    url: GOOGLE_NEWS_MACRO_RSS,
    headerSubtitle: 'Google News · India macro (multi-source)',
    linkHint: 'Tap a headline to open the publisher story.',
  },
  cnbc: {
    id: 'cnbc',
    label: 'CNBC-TV18',
    description: 'CNBC-TV18 economy desk — policy, macro, and market context',
    url: CNBC_TV18_RSS_FEEDS.economy,
    headerSubtitle: 'CNBC-TV18 · Economy',
    linkHint: 'Tap a headline to open the full story on cnbctv18.com.',
  },
};

export const MARKET_NEWS_DEFAULTS = {
  DEFAULT_FEED_ID: 'google' as MarketNewsFeedId,
  SOURCE_LABEL: 'CNBC-TV18',
};