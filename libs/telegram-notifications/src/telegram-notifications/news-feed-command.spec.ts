import { parseNewsFeedCommandArgs } from './news-feed-command';

describe('news-feed-command', () => {
  it('parses google/cnbc/status', () => {
    expect(parseNewsFeedCommandArgs('/newsfeed')).toEqual({ action: 'status' });
    expect(parseNewsFeedCommandArgs('/newsfeed google')).toEqual({
      action: 'google',
    });
    expect(parseNewsFeedCommandArgs('/newsfeed multi')).toEqual({
      action: 'google',
    });
    expect(parseNewsFeedCommandArgs('/newsfeed cnbc')).toEqual({
      action: 'cnbc',
    });
    expect(parseNewsFeedCommandArgs('/newsfeed cnbctv18')).toEqual({
      action: 'cnbc',
    });
  });
});