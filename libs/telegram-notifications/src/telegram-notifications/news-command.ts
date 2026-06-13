import { FastifyInstance } from 'fastify';
import { DEFAULT_TELEGRAM_VOICE, TelegramVoice } from '../types/telegram-voice';
import { MarketNewsFeedId } from '../types/market-news-feed';
import {
  fetchMarketNewsHeadlines,
  isMarketNewsEnabled,
} from './market-news';
import { formatNewsTelegramMessage } from './market-news-formatter';

export function parseNewsCommandArgs(text: string): { limit: number } {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  const raw = parts[1] ? Number(parts[1]) : 8;
  if (!Number.isFinite(raw) || raw <= 0) {
    return { limit: 8 };
  }
  return { limit: Math.min(15, Math.max(3, Math.round(raw))) };
}

export async function buildNewsTelegramMessage(
  fastify: FastifyInstance,
  params?: {
    text?: string;
    voice?: TelegramVoice;
    feedId?: MarketNewsFeedId;
  },
): Promise<{ message: string; error?: string }> {
  const voice = params?.voice ?? DEFAULT_TELEGRAM_VOICE;
  const feedId =
    params?.feedId ?? fastify.telegramNotifications?.getNewsFeed?.() ?? 'google';

  if (!isMarketNewsEnabled()) {
    return {
      message: '',
      error: 'Market news feed is disabled on this bot (TELEGRAM_MARKET_NEWS_ENABLED=false).',
    };
  }

  const { limit } = parseNewsCommandArgs(params?.text ?? '/news');
  const headlines = await fetchMarketNewsHeadlines(limit, feedId);

  if (!headlines.length) {
    return {
      message: '',
      error: 'Could not fetch headlines right now — RSS may be slow. Try again in a minute.',
    };
  }

  return {
    message: formatNewsTelegramMessage(headlines, feedId, voice),
  };
}