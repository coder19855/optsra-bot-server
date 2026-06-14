import fs from 'fs';
import path from 'path';
import { FastifyInstance, FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import {
  loadBenchmarkJob,
  serializeBenchmarkJobStatus,
} from '../benchmark/benchmark-job-store';
import { loadBenchmarkReport } from '../benchmark/benchmark-report-store';
import {
  isDeckAuthSkipped,
  validateTelegramWebAppInitData,
} from '../telegram-notifications/deck-auth';
import { resolveAllowedTelegramUserIds } from '../telegram-notifications/telegram-access';

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

  fastify.get('/api/benchmark/status', async (request, reply) => {
    if (!(await assertBenchmarkAccess(request, reply))) return;

    const { jobId } = request.query as { jobId?: string };
    if (!jobId?.trim()) {
      return reply.code(400).send({ error: 'jobId is required' });
    }

    const job = await loadBenchmarkJob(fastify, jobId.trim());
    if (!job) {
      return reply
        .code(404)
        .send({ error: 'Job not found or expired — run /benchmark again.' });
    }

    return serializeBenchmarkJobStatus(job);
  });
}