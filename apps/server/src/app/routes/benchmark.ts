import fs from 'fs';
import path from 'path';
import { FastifyInstance, FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import { runBenchmark } from '../benchmark/run-benchmark';
import { BenchmarkAiMode, BenchmarkReport } from '../benchmark/types';
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

function serializeReport(report: BenchmarkReport) {
  return {
    ...report,
    trades: report.trades.map((t) => ({
      signalAtMs: t.signalAtMs,
      signalAtISO: t.signalAtISO,
      sessionDate: t.sessionDate,
      action: t.action,
      indexEntry: t.indexEntry,
      indexExit: t.indexExit,
      stopLoss: t.stopLoss,
      takeProfit1: t.takeProfit1,
      takeProfit2: t.takeProfit2,
      takeProfit3: t.takeProfit3,
      exitStatus: t.exitStatus,
      hitLevel: t.hitLevel,
      pnlPoints: t.pnlPoints,
      pnlR: t.pnlR,
      pnlPercent: t.pnlPercent,
      barsHeld: t.barsHeld,
      conviction: t.conviction,
      convictionWithAi: t.convictionWithAi,
      pnlInr: t.pnlInr,
      riskBudgetInr: t.riskBudgetInr,
      optionSource: t.optionSource,
      engineVerdict: t.engineVerdict,
      aiVerdictSummary: t.aiVerdictSummary,
      aiAnalysis: t.aiAnalysis
        ? {
            verdict: t.aiAnalysis.verdict,
            confidenceAdjustment: t.aiAnalysis.confidenceAdjustment,
            betaNote: t.aiAnalysis.betaNote,
          }
        : undefined,
      isWin:
        t.exitStatus === 'TAKE_PROFIT' ||
        (t.pnlR > 0.05 && t.exitStatus !== 'STOP_LOSS'),
    })),
  };
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
        symbol: symbol.trim(),
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
      return serializeReport(report);
    } catch (err) {
      const message = toErrorMessage(err);
      fastify.log.warn({ err }, 'benchmark run failed');
      return reply.code(502).send({ error: message });
    }
  });
}