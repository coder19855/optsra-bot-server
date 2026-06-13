import { FastifyInstance } from 'fastify';
import {
  MARKET_NEWS_DEFAULTS,
  MARKET_NEWS_FEEDS,
} from '../constants/market-news';
import { TELEGRAM_NOTIFICATION_DEFAULTS } from '../constants/telegram-notifications';
import { MarketNewsFeedId } from '../types/market-news-feed';

const NEWS_FEED_PREFERENCE_KEY = 'news-feed-preference';

export interface NewsFeedPreferenceState {
  feedId: MarketNewsFeedId;
}

export function normalizeNewsFeedId(value: unknown): MarketNewsFeedId {
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    if (lower === 'cnbc' || lower === 'cnbctv18' || lower === 'cnbctv-18') {
      return 'cnbc';
    }
    if (lower === 'google' || lower === 'multi' || lower === 'aggregator') {
      return 'google';
    }
  }
  return MARKET_NEWS_DEFAULTS.DEFAULT_FEED_ID;
}

export async function loadNewsFeedPreference(
  fastify: FastifyInstance,
  memoryState: NewsFeedPreferenceState,
): Promise<NewsFeedPreferenceState> {
  const col = fastify.mongo?.db?.collection<
    NewsFeedPreferenceState & { key: string }
  >(TELEGRAM_NOTIFICATION_DEFAULTS.SESSION_STATE_COLLECTION);
  if (!col) return memoryState;

  const doc = await col.findOne({ key: NEWS_FEED_PREFERENCE_KEY });
  if (doc?.feedId == null) return memoryState;

  return { feedId: normalizeNewsFeedId(doc.feedId) };
}

export async function saveNewsFeedPreference(
  fastify: FastifyInstance,
  _memoryState: NewsFeedPreferenceState,
  feedId: MarketNewsFeedId,
): Promise<NewsFeedPreferenceState> {
  const next: NewsFeedPreferenceState = {
    feedId: normalizeNewsFeedId(feedId),
  };

  const col = fastify.mongo?.db?.collection<
    NewsFeedPreferenceState & { key: string }
  >(TELEGRAM_NOTIFICATION_DEFAULTS.SESSION_STATE_COLLECTION);
  if (col) {
    await col.updateOne(
      { key: NEWS_FEED_PREFERENCE_KEY },
      { $set: { key: NEWS_FEED_PREFERENCE_KEY, ...next } },
      { upsert: true },
    );
  }

  return next;
}

export function getNewsFeedOption(feedId: MarketNewsFeedId) {
  return MARKET_NEWS_FEEDS[normalizeNewsFeedId(feedId)];
}