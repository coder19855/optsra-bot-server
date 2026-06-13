import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  DECK_STREAM_DEFAULTS,
  resolveDeckStreamFullRefreshMs,
  resolveDeckStreamTickMs,
} from '../constants/deck-stream';
import {
  buildDeckLivePayload,
  buildDeckLiveStreamTick,
} from './deck-service';

export interface DeckStreamParams {
  symbol: string;
  tradingStyle?: string;
}

function writeSse(reply: FastifyReply, payload: unknown): void {
  reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export function handleDeckStream(
  fastify: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  params: DeckStreamParams,
): void {
  const tickMs = resolveDeckStreamTickMs();
  const fullMs = resolveDeckStreamFullRefreshMs();
  const heartbeatMs = DECK_STREAM_DEFAULTS.HEARTBEAT_MS;

  reply.hijack();
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  let closed = false;

  const cleanup = () => {
    clearInterval(tickTimer);
    clearInterval(fullTimer);
    clearInterval(heartbeatTimer);
  };

  request.raw.on('close', () => {
    closed = true;
    cleanup();
  });

  const sendTick = async () => {
    if (closed) return;
    try {
      const tick = await buildDeckLiveStreamTick(fastify, params);
      writeSse(reply, tick);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      fastify.log.warn({ err }, 'deck stream tick failed');
      writeSse(reply, { type: 'error', message });
    }
  };

  const sendFull = async () => {
    if (closed) return;
    try {
      const full = await buildDeckLivePayload(fastify, params);
      writeSse(reply, { type: 'full', ...full });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      fastify.log.warn({ err }, 'deck stream full refresh failed');
      writeSse(reply, { type: 'error', message });
    }
  };

  const tickTimer = setInterval(() => {
    void sendTick();
  }, tickMs);
  const fullTimer = setInterval(() => {
    void sendFull();
  }, fullMs);
  const heartbeatTimer = setInterval(() => {
    if (!closed) reply.raw.write(': heartbeat\n\n');
  }, heartbeatMs);

  void sendTick();
}