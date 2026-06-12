import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { TELEGRAM_NOTIFICATION_DEFAULTS } from '../constants/telegram-notifications';
import {
  resolveFyersWsEnabled,
  resolveFyersWsSessionCheckMs,
} from '../constants/fyers-market-stream';
import { FyersMarketStreamManager } from '../market-data/fyers-market-stream-manager';
import {
  bindMarketStreamHooks,
  notifyWatchIndexSymbols,
} from '../market-data/market-stream-coordinator';
import { getQuoteCache } from '../market-data/quote-cache';
import { isIndianMarketOpen } from '../telegram-notifications/signal-tracker';

function parseWatchSymbols(): string[] {
  const raw = process.env.TELEGRAM_NOTIFY_SYMBOLS;
  if (raw?.trim()) {
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [...TELEGRAM_NOTIFICATION_DEFAULTS.DEFAULT_SYMBOLS];
}

export default fp(
  async (fastify: FastifyInstance) => {
    const enabled = resolveFyersWsEnabled();
    const manager = new FyersMarketStreamManager(fastify.log);
    let sessionTimer: NodeJS.Timeout | null = null;

    bindMarketStreamHooks({
      onOptionChainFetched: (indexSymbol, response) => {
        manager.onOptionChainFetched(indexSymbol, response);
      },
      syncOpenOutcomeSymbols: (symbols) => {
        manager.syncOpenOutcomeSymbols(symbols);
      },
      addWatchIndexSymbols: (symbols) => {
        manager.addWatchIndexSymbols(symbols);
      },
    });

    notifyWatchIndexSymbols(parseWatchSymbols());

    async function syncSession(): Promise<void> {
      if (!enabled) return;

      const marketOpen = isIndianMarketOpen(
        Date.now(),
        TELEGRAM_NOTIFICATION_DEFAULTS.IST_TIMEZONE,
        TELEGRAM_NOTIFICATION_DEFAULTS.SESSION_OPEN,
        TELEGRAM_NOTIFICATION_DEFAULTS.SESSION_CLOSE,
      );

      if (!marketOpen) {
        if (manager.isConnected()) {
          await manager.disconnect();
        }
        return;
      }

      const tokenOk = await fastify.ensureFyersSession();
      if (!tokenOk) {
        await manager.disconnect();
        return;
      }

      const appId = process.env.FYERS_API_KEY || '';
      const accessToken = await fastify.fyers.getAccessToken();
      if (!appId || !accessToken) return;

      await manager.connect(accessToken, appId);
    }

    fastify.decorate('fyersMarketStream', {
      isEnabled: () => enabled,
      isConnected: () => manager.isConnected(),
      getIndexLtp: (symbol: string) => manager.getIndexLtp(symbol),
      getOptionLtp: (symbol: string) => manager.getOptionLtp(symbol),
      getSpotSeries: (symbol: string, maxAgeMs?: number) =>
        manager.getSpotSeries(symbol, maxAgeMs),
      getQuote: (symbol: string) => getQuoteCache().get(symbol),
      getStats: () => manager.getStats(enabled),
      syncSession: () => syncSession(),
    });

    if (enabled) {
      void syncSession().catch((err) => {
        fastify.log.warn({ err }, 'Initial Fyers WS session sync failed');
      });

      sessionTimer = setInterval(() => {
        void syncSession().catch((err) => {
          fastify.log.warn({ err }, 'Fyers WS session sync failed');
        });
      }, resolveFyersWsSessionCheckMs());
      sessionTimer.unref();
    }

    fastify.addHook('onClose', async () => {
      if (sessionTimer) {
        clearInterval(sessionTimer);
        sessionTimer = null;
      }
      bindMarketStreamHooks(null);
      await manager.disconnect();
    });
  },
  {
    name: 'fyers-market-stream',
    dependencies: ['fyers', 'market-data-cache'],
  },
);