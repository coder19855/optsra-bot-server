import { loadNewsFeedPreference, saveNewsFeedPreference } from './news-feed-preference';

describe('news-feed-preference', () => {
  it('round-trips feed preference in memory when mongo is absent', async () => {
    const fastify = { mongo: undefined } as never;
    const saved = await saveNewsFeedPreference(fastify, { feedId: 'google' }, 'cnbc');
    expect(saved.feedId).toBe('cnbc');
    const loaded = await loadNewsFeedPreference(fastify, { feedId: 'google' });
    expect(loaded.feedId).toBe('google');
  });
});