import axios from 'axios';
import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import {
  TELEGRAM_API_BASE,
  TELEGRAM_NOTIFICATION_DEFAULTS,
} from '../constants/telegram-notifications';
import { formatTelegramAlertMessage } from '../telegram-notifications/message-formatter';
import {
  buildSignalSnapshot,
  detectSignalChange,
  isIndianMarketOpen,
  snapshotKey,
} from '../telegram-notifications/signal-tracker';
import { fetchTradeDecisionAlert } from '../telegram-notifications/trade-decision-fetch';
import {
  SignalSnapshot,
  TelegramNotificationStatus,
} from '../types/telegram-notifications';
import { TradingStyle } from '../types/trading-style';

function parseCsvEnv(value: string | undefined, fallback: string[]): string[] {
  if (!value?.trim()) return fallback;
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseTradingStyles(values: string[]): TradingStyle[] {
  return values.map((v) => {
    const upper = v.toUpperCase();
    if (upper === TradingStyle.Scalper) return TradingStyle.Scalper;
    if (upper === TradingStyle.Positional) return TradingStyle.Positional;
    return TradingStyle.Intraday;
  });
}

export default fp(
  async (fastify: FastifyInstance) => {
    const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim() || '';
    const chatId = process.env.TELEGRAM_CHAT_ID?.trim() || '';
    const enabled =
      (process.env.TELEGRAM_NOTIFICATIONS_ENABLED ?? 'true').toLowerCase() !==
      'false';
    const configured = Boolean(botToken && chatId);
    const pollIntervalMs = Number(
      process.env.TELEGRAM_POLL_INTERVAL_MS ||
        TELEGRAM_NOTIFICATION_DEFAULTS.POLL_INTERVAL_MS,
    );

    const watchedSymbols = parseCsvEnv(
      process.env.TELEGRAM_NOTIFY_SYMBOLS,
      [...TELEGRAM_NOTIFICATION_DEFAULTS.DEFAULT_SYMBOLS],
    );
    const watchedStyles = parseTradingStyles(
      parseCsvEnv(
        process.env.TELEGRAM_NOTIFY_STYLES,
        TELEGRAM_NOTIFICATION_DEFAULTS.DEFAULT_TRADING_STYLES.map(String),
      ),
    );

    const memorySnapshots = new Map<string, SignalSnapshot>();
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let lastPollAt: Date | null = null;
    let lastPollError: string | null = null;

    const collectionName = TELEGRAM_NOTIFICATION_DEFAULTS.COLLECTION;

    function getCollection() {
      return fastify.mongo?.db?.collection<SignalSnapshot>(collectionName);
    }

    async function loadSnapshot(
      symbol: string,
      tradingStyle: TradingStyle,
    ): Promise<SignalSnapshot | null> {
      const key = snapshotKey(symbol, tradingStyle);
      const col = getCollection();
      if (col) {
        const doc = await col.findOne({ key });
        if (doc) return doc;
      }
      return memorySnapshots.get(key) ?? null;
    }

    async function saveSnapshot(snapshot: SignalSnapshot): Promise<void> {
      memorySnapshots.set(snapshot.key, snapshot);
      const col = getCollection();
      if (!col) return;
      await col.updateOne(
        { key: snapshot.key },
        { $set: snapshot },
        { upsert: true },
      );
    }

    async function sendTelegramMessage(text: string): Promise<void> {
      if (!configured) {
        throw new Error('Telegram is not configured (missing bot token or chat id)');
      }
      const url = `${TELEGRAM_API_BASE}/bot${botToken}/sendMessage`;
      await axios.post(url, {
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });
    }

    async function evaluateAndNotify(
      symbol: string,
      tradingStyle: TradingStyle,
      options?: { force?: boolean },
    ): Promise<{ notified: boolean; snapshot: SignalSnapshot }> {
      const payload = await fetchTradeDecisionAlert(
        fastify,
        symbol,
        tradingStyle,
      );
      if (!payload) {
        throw new Error(`No trade decision payload for ${symbol}`);
      }

      const previous = await loadSnapshot(symbol, tradingStyle);
      const current = buildSignalSnapshot(payload);
      const change = detectSignalChange(previous, current, {
        minConvictionForInitial:
          TELEGRAM_NOTIFICATION_DEFAULTS.MIN_CONVICTION_FOR_INITIAL_ALERT,
      });

      const shouldSend = options?.force || change.shouldNotify;
      if (shouldSend) {
        const message = formatTelegramAlertMessage({
          payload,
          previous: change.previous,
          current: change.current,
          kinds: change.kinds.length ? change.kinds : ['ACTION'],
        });
        await sendTelegramMessage(message);
        current.lastNotifiedAt = new Date();
        current.lastNotifiedFingerprint = current.fingerprint;
      }

      await saveSnapshot(current);
      return { notified: shouldSend, snapshot: current };
    }

    async function pollAll(options?: { force?: boolean }): Promise<void> {
      lastPollError = null;
      const marketOpen = isIndianMarketOpen(
        Date.now(),
        TELEGRAM_NOTIFICATION_DEFAULTS.IST_TIMEZONE,
        TELEGRAM_NOTIFICATION_DEFAULTS.SESSION_OPEN,
        TELEGRAM_NOTIFICATION_DEFAULTS.SESSION_CLOSE,
      );

      if (!options?.force && !marketOpen) {
        fastify.log.debug('Telegram poll skipped — Indian market closed');
        return;
      }

      for (const symbol of watchedSymbols) {
        for (const style of watchedStyles) {
          try {
            await evaluateAndNotify(symbol, style, options);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            lastPollError = msg;
            fastify.log.error(
              { err, symbol, style },
              'Telegram notification poll failed for watch item',
            );
          }
        }
      }
      lastPollAt = new Date();
    }

    function startPolling(): void {
      if (pollTimer) return;
      pollTimer = setInterval(() => {
        void pollAll();
      }, pollIntervalMs);
      fastify.log.info(
        {
          pollIntervalMs,
          symbols: watchedSymbols,
          styles: watchedStyles,
        },
        'Telegram signal notifications polling started',
      );
    }

    function stopPolling(): void {
      if (!pollTimer) return;
      clearInterval(pollTimer);
      pollTimer = null;
      fastify.log.info('Telegram signal notifications polling stopped');
    }

    async function getStatus(): Promise<TelegramNotificationStatus> {
      const snapshots: TelegramNotificationStatus['snapshots'] = [];
      for (const symbol of watchedSymbols) {
        for (const style of watchedStyles) {
          const snap = await loadSnapshot(symbol, style);
          if (!snap) continue;
          snapshots.push({
            key: snap.key,
            action: snap.action,
            bias: snap.bias,
            conviction: snap.conviction,
            shouldConsiderTrade: snap.shouldConsiderTrade,
            topStrategy: snap.topStrategy,
            updatedAt: snap.updatedAt.toISOString(),
            lastNotifiedAt: snap.lastNotifiedAt
              ? snap.lastNotifiedAt.toISOString()
              : null,
          });
        }
      }

      return {
        enabled: enabled && configured,
        configured,
        polling: pollTimer != null,
        pollIntervalMs,
        marketOpen: isIndianMarketOpen(
          Date.now(),
          TELEGRAM_NOTIFICATION_DEFAULTS.IST_TIMEZONE,
          TELEGRAM_NOTIFICATION_DEFAULTS.SESSION_OPEN,
          TELEGRAM_NOTIFICATION_DEFAULTS.SESSION_CLOSE,
        ),
        watched: watchedSymbols.flatMap((symbol) =>
          watchedStyles.map((tradingStyle) => ({ symbol, tradingStyle })),
        ),
        lastPollAt: lastPollAt ? lastPollAt.toISOString() : null,
        lastPollError,
        snapshots,
      };
    }

    fastify.decorate('telegramNotifications', {
      isConfigured: () => configured,
      isEnabled: () => enabled && configured,
      sendMessage: sendTelegramMessage,
      pollNow: (force = false) => pollAll({ force }),
      getStatus,
      startPolling,
      stopPolling,
    });

    if (enabled && configured) {
      fastify.addHook('onReady', async () => {
        startPolling();
        try {
          await pollAll();
        } catch (err) {
          fastify.log.warn({ err }, 'Initial Telegram poll failed');
        }
      });
    } else {
      fastify.log.warn(
        'Telegram notifications disabled — set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID',
      );
    }

    fastify.addHook('onClose', async () => {
      stopPolling();
    });
  },
  { name: 'telegram-notifications' },
);