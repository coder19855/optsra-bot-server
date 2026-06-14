import fs from 'fs';
import path from 'path';
import { FastifyInstance, FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import {
  isDeckAuthSkipped,
  validateTelegramWebAppInitData,
} from '../telegram-notifications/deck-auth';
import { resolveDeckSseEnabled } from '../constants/deck-stream';
import { handleDeckStream } from '../telegram-notifications/deck-stream-handler';
import {
  buildDeckLiveEnrichmentPayload,
  buildDeckLivePayload,
  buildDeckReplayPayload,
  buildDeckReplayTradesPayload,
} from '../telegram-notifications/deck-service';
import { resolveAllowedTelegramUserIds } from '../telegram-notifications/telegram-access';

function resolveDeckAssetRoot(): string {
  const candidates = [
    path.join(__dirname, '..', '..', 'assets', 'deck'),
    path.join(process.cwd(), 'apps/server/dist/apps/server/src/assets/deck'),
    path.join(process.cwd(), 'apps/server/src/assets/deck'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'index.html'))) {
      return candidate;
    }
  }
  return candidates[0];
}

function readInitData(request: FastifyRequest): string {
  const header = request.headers['x-telegram-init-data'];
  if (typeof header === 'string' && header.trim()) return header.trim();
  const query = request.query as { initData?: string };
  return query.initData?.trim() ?? '';
}

async function assertDeckAccess(
  request: FastifyRequest,
  reply: import('fastify').FastifyReply,
): Promise<boolean> {
  if (isDeckAuthSkipped()) return true;

  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim() ?? '';
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim() ?? '';
  const initData = readInitData(request);
  const auth = validateTelegramWebAppInitData(initData, botToken);
  if (!auth.ok) {
    reply.code(401).send({ error: 'Unauthorized', reason: auth.reason });
    return false;
  }

  const allowed = resolveAllowedTelegramUserIds(chatId);
  if (allowed.size > 0 && auth.userId && !allowed.has(auth.userId)) {
    reply.code(403).send({ error: 'Forbidden' });
    return false;
  }

  return true;
}

export default async function deckRoutes(fastify: FastifyInstance) {
  const root = resolveDeckAssetRoot();

  await fastify.register(fastifyStatic, {
    root,
    prefix: '/deck/',
    decorateReply: false,
    index: ['index.html'],
  });

  fastify.get('/deck', async (_request, reply) => {
    return reply.redirect('/deck/');
  });

  fastify.get('/api/deck/stream', async (request, reply) => {
    if (!(await assertDeckAccess(request, reply))) return;

    if (!resolveDeckSseEnabled()) {
      return reply.code(404).send({ error: 'Deck SSE disabled' });
    }

    const { symbol, style } = request.query as {
      symbol?: string;
      style?: string;
    };
    if (!symbol?.trim()) {
      return reply.code(400).send({ error: 'symbol is required' });
    }

    handleDeckStream(fastify, request, reply, {
      symbol: symbol.trim(),
      tradingStyle: style,
    });
  });

  fastify.get('/api/deck/live', async (request, reply) => {
    if (!(await assertDeckAccess(request, reply))) return;

    const { symbol, style, scope } = request.query as {
      symbol?: string;
      style?: string;
      scope?: string;
    };
    if (!symbol?.trim()) {
      return reply.code(400).send({ error: 'symbol is required' });
    }

    try {
      const trimmedSymbol = symbol.trim();
      const payload =
        scope === 'enrichment'
          ? await buildDeckLiveEnrichmentPayload(fastify, {
              symbol: trimmedSymbol,
              tradingStyle: style,
            })
          : await buildDeckLivePayload(fastify, {
              symbol: trimmedSymbol,
              tradingStyle: style,
            });
      return payload;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      fastify.log.warn({ err }, 'deck live failed');
      return reply.code(502).send({ error: message });
    }
  });

  fastify.get('/api/deck/replay-trades', async (request, reply) => {
    if (!(await assertDeckAccess(request, reply))) return;

    const { symbol, style, date } = request.query as {
      symbol?: string;
      style?: string;
      date?: string;
    };
    if (!symbol?.trim()) {
      return reply.code(400).send({ error: 'symbol is required' });
    }
    if (!date?.trim()) {
      return reply.code(400).send({ error: 'date is required (YYYY-MM-DD)' });
    }

    try {
      const payload = await buildDeckReplayTradesPayload(fastify, {
        symbol: symbol.trim(),
        tradingStyle: style,
        sessionDate: date.trim(),
      });
      return payload;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      fastify.log.warn({ err }, 'deck replay trades failed');
      return reply.code(502).send({ error: message });
    }
  });

  fastify.get('/api/deck/replay', async (request, reply) => {
    if (!(await assertDeckAccess(request, reply))) return;

    const { symbol, style, date } = request.query as {
      symbol?: string;
      style?: string;
      date?: string;
    };
    if (!symbol?.trim()) {
      return reply.code(400).send({ error: 'symbol is required' });
    }

    try {
      const payload = await buildDeckReplayPayload(fastify, {
        symbol: symbol.trim(),
        tradingStyle: style,
        sessionDate: date,
      });
      return payload;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      fastify.log.warn({ err }, 'deck replay failed');
      return reply.code(502).send({ error: message });
    }
  });
}