import { formatMarketNewsHeadlineLine } from './market-news-formatter';
import { parseNewsCommandArgs } from './news-command';

describe('news-command', () => {
  it('parses optional headline limit', () => {
    expect(parseNewsCommandArgs('/news')).toEqual({ limit: 8 });
    expect(parseNewsCommandArgs('/news 5')).toEqual({ limit: 5 });
    expect(parseNewsCommandArgs('/news 99')).toEqual({ limit: 15 });
    expect(parseNewsCommandArgs('/news 0')).toEqual({ limit: 8 });
  });

  it('formats headlines with clickable links', () => {
    const line = formatMarketNewsHeadlineLine({
      title: 'RBI holds rates steady',
      source: 'Mint',
      publishedAt: 'Wed, 11 Jun 2026 09:30:00 GMT',
      url: 'https://example.com/story',
    });
    expect(line).toContain('<a href="https://example.com/story">');
    expect(line).toContain('RBI holds rates steady');
    expect(line).toContain('(Mint)');
  });
});