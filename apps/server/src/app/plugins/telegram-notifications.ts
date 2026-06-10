import axios from 'axios';
import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import {
  TELEGRAM_API_BASE,
  TELEGRAM_NOTIFICATION_DEFAULTS,
} from '../constants/telegram-notifications';
import {
  buildAlertChannelStatus,
  resolveSendParams,
  TELEGRAM_SOUND_ROUTING_NOTE,
} from '../telegram-notifications/alert-channels';
import { formatTelegramAlertMessage } from '../telegram-notifications/message-formatter';
import {
  loadSessionCoachState,
  saveSessionCoachState,
  sendSessionCoachSummary,
  SessionCoachState,
} from '../telegram-notifications/session-coach';
import {
  isPreSessionLearningEnabled,
  loadSessionLearningState,
  saveSessionLearningState,
  sendPreSessionLearningBrief,
  SessionLearningState,
} from '../telegram-notifications/session-learning';
import {
  buildSignalSnapshot,
  detectSignalChange,
  getIstSessionClock,
  isIndianMarketOpen,
  isWithinPostSessionCoachWindow,
  isWithinPreSessionLearningWindow,
  snapshotKey,
} from '../telegram-notifications/signal-tracker';
import { saveAlertWhyContext } from '../telegram-notifications/alert-context-store';
import { evaluateOpenPositionTpAlerts } from '../telegram-notifications/position-monitor';
import {
  closeSessionSignalOutcomes,
  recordSignalOutcome,
  updateOpenSignalOutcomes,
} from '../telegram-notifications/signal-outcome-tracker';
import { fetchTradeDecisionAlert } from '../telegram-notifications/trade-decision-fetch';
import { recordTradeEntryIntent } from '../telegram-notifications/trade-entry-intent';
import {
  getFyersLoginReminderContent,
  shouldSendFyersLoginReminder,
} from '../telegram-notifications/fyers-login-reminder';
import { resolveAllowedTelegramUserIds } from '../telegram-notifications/telegram-access';
import {
  TelegramMessageJournal,
  clearBotMessagesByScan,
} from '../telegram-notifications/telegram-message-journal';
import { TelegramCommandPoller } from '../telegram-notifications/telegram-commands';
import {
  loadPollingPauseState,
  PollingPauseState,
  savePollingPauseState,
} from '../telegram-notifications/polling-pause';
import {
  SignalSnapshot,
  TelegramNotificationStatus,
  TelegramSendOptions,
  TpMonitorSnapshot,
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
    const allowedUserIds = resolveAllowedTelegramUserIds(chatId);
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
    let sessionCoachState: SessionCoachState = {
      lastSessionDate: null,
      lastSentAt: null,
      lastError: null,
    };
    let sessionLearningState: SessionLearningState = {
      lastSessionDate: null,
      lastSentAt: null,
      lastError: null,
    };
    let pollingPauseState: PollingPauseState = {
      alertsPaused: false,
      pausedAt: null,
    };
    const tpMemory = new Map<string, TpMonitorSnapshot>();
    let lastTpAlertAt: Date | null = null;
    let openPositionsMonitored = 0;
    let openPositionsTracked = 0;
    let commandPoller: TelegramCommandPoller | null = null;
    let lastFyersLoginReminderAt: Date | null = null;
    const messageJournal = new TelegramMessageJournal();
    const lastExactStrikeByKey = new Map<string, NonNullable<
      Awaited<ReturnType<typeof fetchTradeDecisionAlert>>
    >['exactStrikeRecommendation']>();

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

    async function sendTelegramMessage(
      text: string,
      options?: TelegramSendOptions,
    ): Promise<void> {
      if (!configured) {
        throw new Error('Telegram is not configured (missing bot token or chat id)');
      }
      const send = resolveSendParams(chatId, options);
      const url = `${TELEGRAM_API_BASE}/bot${botToken}/sendMessage`;
      const payload: Record<string, unknown> = {
        chat_id: send.chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        disable_notification: send.disableNotification,
      };
      if (options?.inlineKeyboard?.length) {
        payload.reply_markup = { inline_keyboard: options.inlineKeyboard };
      }
      const res = await axios.post(url, payload);
      const messageId = res.data?.result?.message_id as number | undefined;
      if (
        messageId != null &&
        !options?.skipMessageTracking
      ) {
        messageJournal.record(send.chatId, messageId);
      }
    }

    async function clearBotMessagesInChat(
      targetChatId: number,
      options?: { limit?: number; anchorMessageId: number },
    ): Promise<{ deleted: number; failed: number }> {
      const result = await clearBotMessagesByScan({
        botToken,
        journal: messageJournal,
        chatId: targetChatId,
        anchorMessageId: options?.anchorMessageId ?? 0,
        limit: options?.limit,
      });
      return {
        deleted: result.deleted,
        failed: Math.max(0, result.scanned - result.deleted),
      };
    }

    async function maybeSendFyersLoginReminder(
      sendOptions?: TelegramSendOptions,
    ): Promise<void> {
      if (!shouldSendFyersLoginReminder(lastFyersLoginReminderAt)) return;

      const { text, options } = getFyersLoginReminderContent();
      await sendTelegramMessage(text, {
        channel: 'default',
        ...options,
        ...sendOptions,
      });
      lastFyersLoginReminderAt = new Date();
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

      const polledAt = new Date();
      if (payload.whyContext) {
        try {
          await saveAlertWhyContext(fastify, {
            ...payload.whyContext,
            alertedAt: polledAt.toISOString(),
            source: 'poll',
            wasNotified: false,
          });
        } catch (err) {
          fastify.log.warn({ err }, 'Failed to save poll why-context');
        }
      }

      if (payload.exactStrikeRecommendation) {
        lastExactStrikeByKey.set(
          snapshotKey(symbol, tradingStyle),
          payload.exactStrikeRecommendation,
        );
      }

      const shouldSend = options?.force || change.shouldNotify;
      if (shouldSend) {
        const notifiedAt = new Date();
        const message = formatTelegramAlertMessage({
          payload,
          previous: change.previous,
          current: change.current,
          kinds: change.kinds.length ? change.kinds : ['ACTION'],
        });
        await sendTelegramMessage(message, { channel: 'signal' });
        current.lastNotifiedAt = notifiedAt;
        current.lastNotifiedFingerprint = current.fingerprint;

        if (payload.whyContext) {
          try {
            await saveAlertWhyContext(fastify, {
              ...payload.whyContext,
              alertedAt: notifiedAt.toISOString(),
              source: 'alert',
              wasNotified: true,
            });
          } catch (err) {
            fastify.log.warn({ err }, 'Failed to save alert why-context');
          }
        }

        if (payload.exactStrikeRecommendation) {
          try {
            await recordSignalOutcome(
              fastify,
              payload,
              payload.exactStrikeRecommendation,
              notifiedAt,
            );
          } catch (err) {
            fastify.log.warn({ err }, 'Failed to record signal outcome');
          }
        }

        const entryDirection =
          payload.action === 'CE-BUY' || payload.action === 'PE-BUY'
            ? payload.action
            : payload.priceAction.action === 'CE-BUY' ||
                payload.priceAction.action === 'PE-BUY'
              ? payload.priceAction.action
              : null;
        if (
          entryDirection &&
          payload.tradeGuidance.shouldConsiderTrade
        ) {
          try {
            await recordTradeEntryIntent(fastify, {
              indexSymbol: payload.symbol,
              tradingStyle,
              direction: entryDirection,
            });
          } catch (err) {
            fastify.log.warn({ err }, 'Failed to record trade entry intent');
          }
        }
      }

      await saveSnapshot(current);
      return { notified: shouldSend, snapshot: current };
    }

    async function loadAllSnapshots(): Promise<SignalSnapshot[]> {
      const snapshots: SignalSnapshot[] = [];
      for (const symbol of watchedSymbols) {
        for (const style of watchedStyles) {
          const snap = await loadSnapshot(symbol, style);
          if (snap) snapshots.push(snap);
        }
      }
      return snapshots;
    }

    async function maybeSendPreSessionLearning(options?: {
      force?: boolean;
    }): Promise<void> {
      if (!isPreSessionLearningEnabled()) return;

      fastify.fyersUsage.beginScope('telegram-learning');
      try {
        const sessionReady = await fastify.ensureFyersSession({
          verifyWithApi: true,
        });
        if (!sessionReady) {
          fastify.log.debug(
            'Pre-session learning skipped — Fyers token missing or API rejected',
          );
          return;
        }

        const now = Date.now();
        const timezone = TELEGRAM_NOTIFICATION_DEFAULTS.IST_TIMEZONE;
        const inWindow = isWithinPreSessionLearningWindow(
          now,
          timezone,
          TELEGRAM_NOTIFICATION_DEFAULTS.PRE_SESSION_LEARNING_START,
          TELEGRAM_NOTIFICATION_DEFAULTS.PRE_SESSION_LEARNING_END,
        );

        if (!options?.force && !inWindow) return;

        const { sessionDate } = getIstSessionClock(now, timezone);
        sessionLearningState = await loadSessionLearningState(
          fastify,
          sessionLearningState,
        );

        if (!options?.force && sessionLearningState.lastSessionDate === sessionDate) {
          return;
        }

        try {
          await sendPreSessionLearningBrief(fastify, {
            watchedSymbols,
            watchedStyles,
            sendMessage: (text) =>
              sendTelegramMessage(text, { channel: 'default' }),
          });
          sessionLearningState = await saveSessionLearningState(
            fastify,
            sessionLearningState,
            {
              lastSessionDate: sessionDate,
              lastSentAt: new Date(),
              lastError: null,
            },
          );
          fastify.log.info(
            { sessionDate },
            'Telegram pre-session learning brief sent',
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          sessionLearningState = await saveSessionLearningState(
            fastify,
            sessionLearningState,
            {
              lastSessionDate: sessionDate,
              lastSentAt: new Date(),
              lastError: msg,
            },
          );
          fastify.log.error(
            { err, sessionDate },
            'Telegram pre-session learning brief failed',
          );
        }
      } finally {
        fastify.fyersUsage.endScope('telegram-learning');
      }
    }

    async function maybeSendSessionCoachSummary(options?: {
      force?: boolean;
      coachOnly?: boolean;
    }): Promise<void> {
      fastify.fyersUsage.beginScope('telegram-coach');
      try {
        const sessionReady = await fastify.ensureFyersSession({
          verifyWithApi: true,
        });
        if (!sessionReady) {
          fastify.log.debug(
            'Session coach skipped — Fyers token missing or API rejected',
          );
          return;
        }

        const now = Date.now();
        const timezone = TELEGRAM_NOTIFICATION_DEFAULTS.IST_TIMEZONE;
        const inCoachWindow = isWithinPostSessionCoachWindow(
          now,
          timezone,
          TELEGRAM_NOTIFICATION_DEFAULTS.SESSION_CLOSE,
          TELEGRAM_NOTIFICATION_DEFAULTS.POST_SESSION_COACH_WINDOW_MINUTES,
        );

        const allowCoach = options?.force || options?.coachOnly;
        if (!allowCoach && !inCoachWindow) return;

        const { sessionDate } = getIstSessionClock(now, timezone);
        sessionCoachState = await loadSessionCoachState(
          fastify,
          sessionCoachState,
        );

        if (!allowCoach && sessionCoachState.lastSessionDate === sessionDate) {
          return;
        }

        const snapshots = await loadAllSnapshots();

        try {
          await sendSessionCoachSummary(fastify, {
            sessionDate,
            symbols: watchedSymbols,
            styles: watchedStyles,
            snapshots,
          sendMessage: (text) =>
            sendTelegramMessage(text, { channel: 'coach' }),
        });
        sessionCoachState = await saveSessionCoachState(
            fastify,
            sessionCoachState,
            {
              lastSessionDate: sessionDate,
              lastSentAt: new Date(),
              lastError: null,
            },
          );
          fastify.log.info(
            { sessionDate },
            'Telegram end-of-session trading coach summary sent',
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          sessionCoachState = await saveSessionCoachState(
            fastify,
            sessionCoachState,
            {
              lastSessionDate: sessionDate,
              lastSentAt: new Date(),
              lastError: msg,
            },
          );
          fastify.log.error(
            { err, sessionDate },
            'Telegram end-of-session trading coach summary failed',
          );
        }
      } finally {
        fastify.fyersUsage.endScope('telegram-coach');
      }
    }

    async function pollAll(options?: {
      force?: boolean;
      coachOnly?: boolean;
    }): Promise<void> {
      fastify.fyersUsage.beginScope('telegram-poll');
      try {
      lastPollError = null;
      const now = Date.now();
      const timezone = TELEGRAM_NOTIFICATION_DEFAULTS.IST_TIMEZONE;
      const marketOpen = isIndianMarketOpen(
        now,
        timezone,
        TELEGRAM_NOTIFICATION_DEFAULTS.SESSION_OPEN,
        TELEGRAM_NOTIFICATION_DEFAULTS.SESSION_CLOSE,
      );
      const inCoachWindow = isWithinPostSessionCoachWindow(
        now,
        timezone,
        TELEGRAM_NOTIFICATION_DEFAULTS.SESSION_CLOSE,
        TELEGRAM_NOTIFICATION_DEFAULTS.POST_SESSION_COACH_WINDOW_MINUTES,
      );
      const inPreSessionWindow =
        isPreSessionLearningEnabled() &&
        isWithinPreSessionLearningWindow(
          now,
          timezone,
          TELEGRAM_NOTIFICATION_DEFAULTS.PRE_SESSION_LEARNING_START,
          TELEGRAM_NOTIFICATION_DEFAULTS.PRE_SESSION_LEARNING_END,
        );

      if (!options?.force && !marketOpen && !inCoachWindow && !inPreSessionWindow) {
        fastify.log.debug(
          'Telegram poll skipped — outside market, coach, and pre-session windows',
        );
        return;
      }

      const tokenValid = await fastify.ensureFyersSession();
      if (!tokenValid) {
        lastPollError =
          'Fyers access token invalid or expired — skipped token-dependent poll steps';
        lastPollAt = new Date();
        fastify.log.debug(lastPollError);
        try {
          await maybeSendFyersLoginReminder();
        } catch (err) {
          fastify.log.warn({ err }, 'Failed to send Fyers login reminder');
        }
        return;
      }

      lastFyersLoginReminderAt = null;

      const alertsPaused = pollingPauseState.alertsPaused;

      if ((inPreSessionWindow || options?.force) && !alertsPaused) {
        try {
          await maybeSendPreSessionLearning(options);
        } catch (err) {
          fastify.log.error(
            { err },
            'Telegram pre-session learning step failed',
          );
        }
      }

      if (!options?.coachOnly && (marketOpen || options?.force)) {
        if (!alertsPaused) {
          const spotBySymbol: Record<string, number> = {};

          for (const symbol of watchedSymbols) {
            for (const style of watchedStyles) {
              try {
                const result = await evaluateAndNotify(symbol, style, options);
                spotBySymbol[symbol] = result.snapshot.lastPrice;
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

          try {
            await updateOpenSignalOutcomes(fastify, {
              symbols: watchedSymbols,
              spotBySymbol,
            });
          } catch (err) {
            fastify.log.warn({ err }, 'Signal outcome tracker update failed');
          }
        } else {
          fastify.log.debug(
            'Telegram signal poll skipped — alerts paused by user',
          );
        }

        try {
          const tpStyle = watchedStyles[0] ?? TradingStyle.Intraday;
          const tpResult = await evaluateOpenPositionTpAlerts(fastify, {
            watchedSymbols,
            tradingStyle: tpStyle,
            tpMemory,
            sendMessage: (text) =>
              sendTelegramMessage(text, { channel: 'tp' }),
            force: options?.force,
          });
          openPositionsMonitored = tpResult.monitored;
          openPositionsTracked = tpResult.tracked;
          if (tpResult.notified > 0) {
            lastTpAlertAt = new Date();
          }
        } catch (err) {
          fastify.log.error({ err }, 'Telegram open-position TP monitor failed');
        }
      }

      if (inCoachWindow || options?.force || options?.coachOnly) {
        const { sessionDate } = getIstSessionClock(now, timezone);
        try {
          const closed = await closeSessionSignalOutcomes(fastify, sessionDate);
          if (closed.length > 0) {
            fastify.log.info(
              { count: closed.length, sessionDate },
              'Paper signal outcomes closed for session',
            );
          }
        } catch (err) {
          fastify.log.warn({ err }, 'Failed to close session signal outcomes');
        }

        try {
          await maybeSendSessionCoachSummary(options);
        } catch (err) {
          fastify.log.error(
            { err },
            'Telegram session coach summary step failed',
          );
        }
      }

      lastPollAt = new Date();
      } finally {
        fastify.fyersUsage.endScope('telegram-poll');
      }
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

      const now = Date.now();
      const timezone = TELEGRAM_NOTIFICATION_DEFAULTS.IST_TIMEZONE;
      const isTokenValid = await fastify.ensureFyersSession();

      return {
        enabled: enabled && configured,
        configured,
        commandAccessRestricted: allowedUserIds.size > 0,
        allowedCommandUsers: allowedUserIds.size,
        isTokenValid,
        alertChannels: buildAlertChannelStatus(chatId),
        soundRoutingNote: TELEGRAM_SOUND_ROUTING_NOTE,
        polling: pollTimer != null,
        alertsPaused: pollingPauseState.alertsPaused,
        alertsPausedAt: pollingPauseState.pausedAt
          ? pollingPauseState.pausedAt.toISOString()
          : null,
        pollIntervalMs,
        marketOpen: isIndianMarketOpen(
          now,
          timezone,
          TELEGRAM_NOTIFICATION_DEFAULTS.SESSION_OPEN,
          TELEGRAM_NOTIFICATION_DEFAULTS.SESSION_CLOSE,
        ),
        preSessionLearningWindow:
          isPreSessionLearningEnabled() &&
          isWithinPreSessionLearningWindow(
            now,
            timezone,
            TELEGRAM_NOTIFICATION_DEFAULTS.PRE_SESSION_LEARNING_START,
            TELEGRAM_NOTIFICATION_DEFAULTS.PRE_SESSION_LEARNING_END,
          ),
        postSessionCoachWindow: isWithinPostSessionCoachWindow(
          now,
          timezone,
          TELEGRAM_NOTIFICATION_DEFAULTS.SESSION_CLOSE,
          TELEGRAM_NOTIFICATION_DEFAULTS.POST_SESSION_COACH_WINDOW_MINUTES,
        ),
        watched: watchedSymbols.flatMap((symbol) =>
          watchedStyles.map((tradingStyle) => ({ symbol, tradingStyle })),
        ),
        lastPollAt: lastPollAt ? lastPollAt.toISOString() : null,
        lastPollError,
        lastCoachSummarySessionDate: sessionCoachState.lastSessionDate,
        lastCoachSummaryAt: sessionCoachState.lastSentAt
          ? sessionCoachState.lastSentAt.toISOString()
          : null,
        lastCoachSummaryError: sessionCoachState.lastError,
        lastLearningBriefSessionDate: sessionLearningState.lastSessionDate,
        lastLearningBriefAt: sessionLearningState.lastSentAt
          ? sessionLearningState.lastSentAt.toISOString()
          : null,
        lastLearningBriefError: sessionLearningState.lastError,
        openPositionsMonitored,
        openPositionsTracked,
        lastTpAlertAt: lastTpAlertAt ? lastTpAlertAt.toISOString() : null,
        tpSnapshots: [...tpMemory.values()].map((snap) => ({
          positionSymbol: snap.positionSymbol,
          isTracked: snap.isTracked,
          trackReason: snap.trackReason,
          highestTpRr: snap.highestTpRr,
          trackedAt: snap.trackedAt ? snap.trackedAt.toISOString() : null,
          approachingTpRr: snap.approachingTpRr,
          lastHoldAdvice: snap.lastHoldAdvice,
          lastAlertKind: snap.lastAlertKind,
          lastNotifiedAt: snap.lastNotifiedAt
            ? snap.lastNotifiedAt.toISOString()
            : null,
        })),
        snapshots,
      };
    }

    async function setAlertsPaused(paused: boolean): Promise<void> {
      pollingPauseState = await savePollingPauseState(
        fastify,
        pollingPauseState,
        {
          alertsPaused: paused,
          pausedAt: paused ? new Date() : null,
        },
      );
      fastify.log.info(
        { alertsPaused: paused },
        paused
          ? 'Telegram signal alerts paused by user'
          : 'Telegram signal alerts resumed',
      );
    }

    async function resumeAlertsAfterLogin(): Promise<boolean> {
      const wasPaused = pollingPauseState.alertsPaused;
      if (!wasPaused) return false;

      await setAlertsPaused(false);
      try {
        await sendTelegramMessage(
          [
            '✅ <b>Fyers connected</b>',
            '▶️ Signal alerts resumed — you’re back on the watch.',
          ].join('\n'),
          { channel: 'default' },
        );
      } catch (err) {
        fastify.log.warn({ err }, 'Failed to send login resume Telegram notice');
      }
      return true;
    }

    fastify.decorate('telegramNotifications', {
      isConfigured: () => configured,
      isEnabled: () => enabled && configured,
      sendMessage: sendTelegramMessage,
      pollNow: (options) => {
        if (typeof options === 'boolean') {
          return pollAll({ force: options });
        }
        return pollAll(options);
      },
      getStatus,
      isAlertsPaused: () => pollingPauseState.alertsPaused,
      setAlertsPaused,
      resumeAlertsAfterLogin,
      startPolling,
      stopPolling,
    });

    if (enabled && configured) {
      fastify.addHook('onReady', async () => {
        sessionCoachState = await loadSessionCoachState(
          fastify,
          sessionCoachState,
        );
        sessionLearningState = await loadSessionLearningState(
          fastify,
          sessionLearningState,
        );
        pollingPauseState = await loadPollingPauseState(
          fastify,
          pollingPauseState,
        );
        if (pollingPauseState.alertsPaused) {
          fastify.log.info(
            { pausedAt: pollingPauseState.pausedAt },
            'Telegram signal alerts loaded in paused state',
          );
        }
        startPolling();
        if (allowedUserIds.size === 0) {
          fastify.log.warn(
            'Telegram commands disabled for all users — set TELEGRAM_ALLOWED_USER_IDS or TELEGRAM_CHAT_ID (private chat user id)',
          );
        } else {
          fastify.log.info(
            { allowedUsers: allowedUserIds.size },
            'Telegram command access restricted to allowlisted user IDs',
          );
        }

        commandPoller = new TelegramCommandPoller(fastify, {
          botToken,
          defaultChatId: chatId,
          allowedUserIds,
          watchedSymbols,
          watchedStyles,
          sendMessage: sendTelegramMessage,
          clearBotMessages: clearBotMessagesInChat,
          getExactStrikeForKey: (symbol, style) =>
            lastExactStrikeByKey.get(snapshotKey(symbol, style)),
          loadSnapshots: loadAllSnapshots,
        });
        await commandPoller.setup();
        commandPoller.start(
          TELEGRAM_NOTIFICATION_DEFAULTS.COMMAND_POLL_INTERVAL_MS,
        );
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
      commandPoller?.stop();
    });
  },
  {
    name: 'telegram-notifications',
    dependencies: ['fyers', 'fyers-usage'],
  },
);