import fs from 'fs';
import path from 'path';
import { FastifyInstance, FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import { loadBenchmarkReport } from '../benchmark/benchmark-report-store';
import { serializeBenchmarkReport } from '../benchmark/benchmark-serialize';
import { runBenchmark } from '../benchmark/run-benchmark';
import { BenchmarkAiMode } from '../benchmark/types';
import { resolveIndexSymbol } from '../telegram-notifications/command-args';
import {
  isDeckAuthSkipped,
  validateTelegramWebAppInitData,
} from '../telegram-notifications/deck-auth';
import { resolveAllowedTelegramUserIds } from '../telegram-notifications/telegram-access';
import { TradingStyle } from '../types/trading-style';
import { parseFlowModeQuery } from '../types/flow-mode';
import { VetoMode } from '../types/veto-mode';
import { toErrorMessage } from '../error-message';

function resolveBenchmarkAssetRoot(): string {
  const candidates = [
    path.join(__dirname, '..', '..', 'assets', 'benchmark'),
    path.join(
      process.cwd(),
      'apps/server/dist/apps/server/src/assets/benchmark',
    ),
    path.join(process.cwd(), 'apps/server/src/assets/benchmark'),
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

async function assertBenchmarkAccess(
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

function parseAiMode(raw?: string): BenchmarkAiMode {
  const v = (raw ?? 'shadow').toLowerCase();
  if (v === 'off' || v === 'noai') return 'off';
  if (v === 'active' || v === 'ailive') return 'active';
  return 'shadow';
}

function parseTradingStyle(styleQuery?: string): TradingStyle {
  const styleStr = (styleQuery || 'INTRADAY').toUpperCase();
  if (styleStr === 'SCALPER' || styleStr === TradingStyle.Scalper) {
    return TradingStyle.Scalper;
  }
  if (styleStr === 'POSITIONAL' || styleStr === TradingStyle.Positional) {
    return TradingStyle.Positional;
  }
  return TradingStyle.Intraday;
}

export default async function benchmarkRoutes(fastify: FastifyInstance) {
  const root = resolveBenchmarkAssetRoot();

  await fastify.register(fastifyStatic, {
    root,
    prefix: '/benchmark/',
    decorateReply: false,
    index: ['index.html'],
  });

  fastify.get('/benchmark', async (_request, reply) => {
    return reply.redirect('/benchmark/');
  });

  fastify.get('/api/benchmark/report', async (request, reply) => {
    const { reportId } = request.query as { reportId?: string };
    if (!reportId?.trim()) {
      return reply.code(400).send({ error: 'reportId is required' });
    }

    const report = await loadBenchmarkReport(fastify, reportId);
    if (!report) {
      return reply
        .code(404)
        .send({ error: 'Report not found or expired — run /benchmark again.' });
    }

    return report;
  });

  fastify.get('/api/benchmark', async (request, reply) => {
    if (!(await assertBenchmarkAccess(request, reply))) return;

    const {
      symbol,
      style,
      days,
      aiMode,
      maxTrades,
      vetoMode,
      flowMode,
    } = request.query as {
      symbol?: string;
      style?: string;
      days?: string;
      aiMode?: string;
      maxTrades?: string;
      vetoMode?: string;
      flowMode?: string;
    };

    if (!symbol?.trim()) {
      return reply.code(400).send({ error: 'symbol is required' });
    }

    const parsedDays = days ? Number(days) : 14;
    const dayCount = Number.isFinite(parsedDays)
      ? Math.min(60, Math.max(3, parsedDays))
      : 14;
    const parsedMaxTrades = maxTrades ? Number(maxTrades) : undefined;
    const maxTradesPerDay =
      parsedMaxTrades != null && Number.isFinite(parsedMaxTrades)
        ? Math.min(20, Math.max(1, parsedMaxTrades))
        : undefined;

    try {
      const report = await runBenchmark(fastify, {
        symbol: resolveIndexSymbol(symbol.trim()),
        tradingStyle: parseTradingStyle(style),
        days: dayCount,
        aiMode: parseAiMode(aiMode),
        maxTradesPerDay,
        vetoMode:
          (vetoMode as VetoMode | undefined) ??
          fastify.telegramNotifications.getVetoMode(),
        flowMode: flowMode
          ? parseFlowModeQuery(flowMode)
          : fastify.telegramNotifications.getFlowMode(),
      });
      return serializeBenchmarkReport(report);
    } catch (err) {
      const message = toErrorMessage(err);
      fastify.log.warn({ err }, 'benchmark run failed');
      return reply.code(502).send({ error: message });
    }
  });
}