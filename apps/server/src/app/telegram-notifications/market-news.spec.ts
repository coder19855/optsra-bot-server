import {
  fetchMarketNewsHeadlines,
  isCnbctv18FeedUrl,
  resolveHeadlineSource,
  resolveMarketNewsRssUrl,
} from './market-news';

jest.mock('axios', () => ({
  get: jest.fn(),
}));

import axios from 'axios';

const mockedGet = axios.get as jest.Mock;

const CNBC_TV18_ECONOMY =
  'https://www.cnbctv18.com/commonfeeds/v1/cne/rss/economy.xml';

const CNBC_ITEM = `<item>
  <title><![CDATA[Sebi gives more time for merchant bankers]]></title>
  <link><![CDATA[https://www.cnbctv18.com/market/sebi-gives-more-time.htm]]></link>
  <pubDate><![CDATA[Thu, 11 Jun 2026 21:57:14 +0530]]></pubDate>
  <dc:creator>PTI</dc:creator>
</item>`;

describe('market-news', () => {
  const originalRssUrl = process.env.TELEGRAM_MARKET_NEWS_RSS_URL;

  afterEach(() => {
    if (originalRssUrl === undefined) {
      delete process.env.TELEGRAM_MARKET_NEWS_RSS_URL;
    } else {
      process.env.TELEGRAM_MARKET_NEWS_RSS_URL = originalRssUrl;
    }
  });

  it('resolves feed-specific RSS URLs', () => {
    delete process.env.TELEGRAM_MARKET_NEWS_RSS_URL;
    expect(resolveMarketNewsRssUrl('google')).toContain('news.google.com');
    expect(resolveMarketNewsRssUrl('cnbc')).toBe(CNBC_TV18_ECONOMY);
  });

  it('detects CNBC-TV18 feed URLs', () => {
    expect(isCnbctv18FeedUrl(CNBC_TV18_ECONOMY)).toBe(true);
    expect(isCnbctv18FeedUrl('https://news.google.com/rss')).toBe(false);
  });

  it('labels CNBC-TV18 headlines with byline when present', () => {
    const { title, source } = resolveHeadlineSource(
      CNBC_ITEM,
      'Sebi gives more time for merchant bankers',
      CNBC_TV18_ECONOMY,
    );
    expect(title).toBe('Sebi gives more time for merchant bankers');
    expect(source).toBe('CNBC-TV18 · PTI');
  });

  it('parses CNBC-TV18 RSS items with links', async () => {
    delete process.env.TELEGRAM_MARKET_NEWS_RSS_URL;
    mockedGet.mockResolvedValue({
      data: `<?xml version="1.0"?><rss><channel>${CNBC_ITEM}</channel></rss>`,
    });

    const headlines = await fetchMarketNewsHeadlines(3, 'cnbc');
    expect(headlines).toHaveLength(1);
    expect(headlines[0].url).toBe(
      'https://www.cnbctv18.com/market/sebi-gives-more-time.htm',
    );
    expect(headlines[0].source).toBe('CNBC-TV18 · PTI');
  });
});