import axios from 'axios';
import { FastifyInstance } from 'fastify';
import {
  TELEGRAM_API_BASE,
  TELEGRAM_NOTIFICATION_DEFAULTS,
} from '../constants/telegram-notifications';
import { AdaptiveConvictionInsight } from '../types/adaptive-conviction';
import { ExactStrikeRecommendation } from '../types/exact-strike-recommendation';
import { SignalSnapshot } from '../types/telegram-notifications';
import {
  TelegramSendOptions,
} from '../types/telegram-notifications';
import {
  FYERS_AUTH_ERROR_REPLY,
  buildFyersLoginInlineKeyboard,
  getFyersLoginReminderContent,
} from './fyers-login-reminder';
import { isFyersAuthError } from './coach-summary-formatter';
import { TradingStyle } from '../types/trading-style';
import {
  buildCoachTelegramMessage,
  parseCoachCommandArgs,
} from './coach-command';
import { computeAdaptiveConviction } from './adaptive-conviction';
import {
  formatSignalOutcomesSummary,
  loadSignalOutcomes,
} from './signal-outcome-tracker';
import {
  formatCommandsReferenceMessage,
  registerTelegramBotCommands,
} from './commands-reference';
import { isTelegramUserAllowed } from './telegram-access';
import { resolveWhyContext } from './why-command';
import { formatWhyAlertMessage } from './why-alert-formatter';
import {
  buildPositionSizingTelegramMessage,
  buildRiskRewardTelegramMessage,
} from './account-commands';
import { buildBestStrikeTelegramMessage } from './best-strike-command';
import { buildNewsTelegramMessage } from './news-command';
import {
  formatNewsFeedStatusMessage,
  parseNewsFeedCommandArgs,
} from './news-feed-command';
import { getNewsFeedOption } from './news-feed-preference';
import { buildLearningTelegramMessage } from './session-learning';
import { formatFyersUsageTelegramMessage } from './fyers-usage-formatter';
import { mergeDeckKeyboard } from './deck-keyboard';
import { parseClearCommandLimit } from './telegram-message-journal';
import { formatTelegramStatusMessage } from './status-formatter';
import { joinTelegramLines, joinTelegramSections } from './message-layout';
import { buildNowTelegramMessage } from './now-command';
import {
  formatVoicePreviewMessage,
  formatVoiceStatusMessage,
  parseVoiceCommandArgs,
} from './voice-command';
import { voiceDisplayName } from './voice-copy';
import {
  formatStyleStatusMessage,
  parseStyleCommandArgs,
  tradingStyleLabel,
} from './style-command';
import {
  formatFlowStatusMessage,
  parseFlowCommandArgs,
} from './flow-command';
import {
  formatVetoStatusMessage,
  parseVetoCommandArgs,
} from './veto-command';
import { alertFormatLabel } from '../types/alert-format';
import {
  formatAlertStatusMessage,
  parseAlertCommandArgs,
} from './alert-command';
import {
  formatAiStatusMessage,
  parseAiCommandArgs,
} from './ai-command';
import { AIProvider } from '../types/ai-agent';
import { buildBenchmarkTelegramMessage } from './benchmark-command';
import { buildBenchmarkWebAppUrl } from './deck-url';

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    text?: string;
    from?: { id: number };
    chat: { id: number };
  };
}

export interface TelegramCommandDeps {
  botToken: string;
  defaultChatId: string;
  /** Only these Telegram user IDs may run commands (empty = deny all). */
  allowedUserIds: Set<string>;
  watchedSymbols: string[];
  watchedStyles: TradingStyle[];
  sendMessage: (text: string, options?: TelegramSendOptions) => Promise<void>;
  getExactStrikeForKey?: (
    symbol: string,
    style: TradingStyle,
  ) => ExactStrikeRecommendation | undefined;
  loadSnapshots?: () => Promise<SignalSnapshot[]>;
  clearBotMessages?: (
    chatId: number,
    options: { anchorMessageId: number; limit?: number },
  ) => Promise<{ deleted: number; failed: number }>;
  /** Blocks auto day-wrap coach while manual /coach is running. */
  onCoachCommandBegin?: () => void;
  onCoachCommandEnd?: () => void;
  /** Marks today's coach as delivered so auto wrap does not duplicate. */
  onCoachCommandComplete?: (sessionDate: string) => Promise<void>;
}

function commandPollLongTimeoutSec(): number {
  const raw = process.env.TELEGRAM_COMMAND_POLL_LONG_TIMEOUT_SEC?.trim();
  const parsed = raw ? Number(raw) : NaN;
  if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 50) {
    return parsed;
  }
  return TELEGRAM_NOTIFICATION_DEFAULTS.COMMAND_POLL_LONG_TIMEOUT_SEC;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class TelegramCommandPoller {
  private offset = 0;
  private stopped = true;
  private errorBackoffMs =
    TELEGRAM_NOTIFICATION_DEFAULTS.COMMAND_POLL_INTERVAL_MS;
  private coachInFlight = false;
  private benchmarkInFlight = false;
  private readonly seenUpdateIds = new Set<number>();

  constructor(
    private readonly fastify: FastifyInstance,
    private readonly deps: TelegramCommandDeps,
  ) {}

  async setup(): Promise<void> {
    try {
      await registerTelegramBotCommands(this.deps.botToken);
    } catch (err) {
      this.fastify.log.warn({ err }, 'Failed to register Telegram bot commands');
    }
  }

  start(errorBackoffMs = TELEGRAM_NOTIFICATION_DEFAULTS.COMMAND_POLL_INTERVAL_MS): void {
    this.stop();
    this.stopped = false;
    this.errorBackoffMs = errorBackoffMs;
    void this.runPollLoop();
  }

  commandsContext() {
    return {
      watchedSymbols: this.deps.watchedSymbols,
      watchedStyles: this.deps.watchedStyles,
    };
  }

  helpText(): string {
    return formatCommandsReferenceMessage(this.commandsContext());
  }

  stop(): void {
    this.stopped = true;
  }

  private async runPollLoop(): Promise<void> {
    while (!this.stopped) {
      if (!this.deps.botToken) {
        await sleep(this.errorBackoffMs);
        continue;
      }

      try {
        await this.fetchUpdates();
      } catch (err) {
        this.fastify.log.debug({ err }, 'Telegram command poll failed');
        await sleep(this.errorBackoffMs);
      }
    }
  }

  private async fetchUpdates(): Promise<void> {
    const longPollSec = commandPollLongTimeoutSec();
    const url = `${TELEGRAM_API_BASE}/bot${this.deps.botToken}/getUpdates`;
    const res = await axios.get(url, {
      params: { offset: this.offset, timeout: longPollSec, limit: 20 },
      timeout: (longPollSec + 10) * 1000,
    });

    const updates = (res.data?.result ?? []) as TelegramUpdate[];
    for (const update of updates) {
      this.offset = Math.max(this.offset, update.update_id + 1);
      if (this.seenUpdateIds.has(update.update_id)) continue;
      this.rememberUpdateId(update.update_id);
      void this.handleUpdate(update).catch((err) => {
        this.fastify.log.warn({ err }, 'Telegram command handler failed');
      });
    }
  }

  private async sendTyping(chatId?: number): Promise<void> {
    if (chatId == null || !this.deps.botToken) return;
    try {
      await axios.post(
        `${TELEGRAM_API_BASE}/bot${this.deps.botToken}/sendChatAction`,
        { chat_id: chatId, action: 'typing' },
        { timeout: 5000 },
      );
    } catch {
      // Non-critical UX hint — ignore failures.
    }
  }

  private rememberUpdateId(updateId: number): void {
    this.seenUpdateIds.add(updateId);
    if (this.seenUpdateIds.size > 256) {
      const oldest = this.seenUpdateIds.values().next().value;
      if (oldest != null) this.seenUpdateIds.delete(oldest);
    }
  }

  private replyOptions(chatId?: number): TelegramSendOptions {
    return chatId != null ? { chatId } : { channel: 'default' };
  }

  private fyersAuthReplyOptions(chatId?: number): TelegramSendOptions {
    return {
      ...this.replyOptions(chatId),
      inlineKeyboard: buildFyersLoginInlineKeyboard(),
    };
  }

  private async handleUpdate(update: TelegramUpdate): Promise<void> {
    const text = update.message?.text?.trim();
    if (!text?.startsWith('/')) return;

    const userId = update.message?.from?.id;
    if (!isTelegramUserAllowed(userId, this.deps.allowedUserIds)) {
      this.fastify.log.debug(
        { userId, chatId: update.message?.chat.id },
        'Ignored Telegram command from unauthorized user',
      );
      return;
    }

    const command = text.split(/\s+/)[0]?.toLowerCase().split('@')[0];
    const replyChatId = update.message?.chat.id;

    void this.sendTyping(replyChatId);

    try {
      if (command === '/why') {
        await this.handleWhy(text, replyChatId);
      } else if (command === '/coach') {
        await this.handleCoach(text, replyChatId);
      } else if (command === '/learning') {
        await this.handleLearning(text, replyChatId);
      } else if (command === '/news' || command === '/headlines') {
        await this.handleNews(text, replyChatId);
      } else if (command === '/newsfeed' || command === '/newssource') {
        await this.handleNewsFeed(text, replyChatId);
      } else if (command === '/best-strike' || command === '/beststrike') {
        await this.handleBestStrike(text, replyChatId);
      } else if (
        command === '/apiusage' ||
        command === '/fyers-usage' ||
        command === '/fyersusage'
      ) {
        await this.handleFyersUsage(replyChatId);
      } else if (command === '/benchmark' || command === '/backtest') {
        await this.handleBenchmark(text, replyChatId);
      } else if (command === '/outcomes') {
        await this.handleOutcomes(replyChatId);
      } else if (command === '/conviction') {
        await this.handleConviction(text, replyChatId);
      } else if (command === '/login') {
        await this.handleLogin(replyChatId);
      } else if (command === '/clear') {
        await this.handleClear(text, replyChatId, update.message?.message_id);
      } else if (command === '/rr' || command === '/riskreward') {
        await this.handleRiskReward(text, replyChatId);
      } else if (command === '/size' || command === '/sizing') {
        await this.handlePositionSizing(text, replyChatId);
      } else if (command === '/help' || command === '/commands') {
        await this.handleHelp(text, replyChatId);
      } else if (command === '/start') {
        await this.handleStart(replyChatId);
      } else if (command === '/stop') {
        await this.handleStop(replyChatId);
      } else if (command === '/status') {
        await this.handleStatus(replyChatId);
      } else if (command === '/now') {
        await this.handleNow(text, replyChatId);
      } else if (command === '/voice') {
        await this.handleVoice(text, replyChatId);
      } else if (command === '/veto') {
        await this.handleVeto(text, replyChatId);
      } else if (command === '/flow') {
        await this.handleFlow(text, replyChatId);
      } else if (command === '/style' || command === '/tradingstyle') {
        await this.handleStyle(text, replyChatId);
      } else if (command === '/alert') {
        await this.handleAlert(text, replyChatId);
      } else if (command === '/ai') {
        await this.handleAi(text, replyChatId);
      }
    } catch (err) {
      this.fastify.log.warn({ err, command }, 'Telegram command failed');
      await this.deps.sendMessage(
        '😅 That command glitched — give it another shot in a sec.',
        this.replyOptions(replyChatId),
      );
    }
  }

  private async handleClear(
    text: string,
    replyChatId?: number,
    commandMessageId?: number,
  ): Promise<void> {
    if (replyChatId == null || !this.deps.clearBotMessages) {
      await this.deps.sendMessage(
        '🤷 Can’t clear messages in this chat.',
        this.replyOptions(replyChatId),
      );
      return;
    }

    if (commandMessageId == null) {
      await this.deps.sendMessage(
        '🤷 Couldn’t find this message — try <code>/clear</code> again.',
        { ...this.replyOptions(replyChatId), skipMessageTracking: true },
      );
      return;
    }

    const limit = parseClearCommandLimit(text);
    const result = await this.deps.clearBotMessages(replyChatId, {
      anchorMessageId: commandMessageId,
      limit,
    });

    if (result.deleted === 0) {
      await this.deps.sendMessage(
        [
          '🧹 Nothing to sweep — no bot messages above this point.',
          '(Your /clear message stays — bots can’t delete yours.)',
        ].join('\n'),
        { ...this.replyOptions(replyChatId), skipMessageTracking: true },
      );
      return;
    }

    await this.deps.sendMessage(
      `🧹 Done — swept ${result.deleted} bot message(s). Chat’s breathing again.`,
      { ...this.replyOptions(replyChatId), skipMessageTracking: true },
    );
  }

  private async handleRiskReward(
    text: string,
    replyChatId?: number,
  ): Promise<void> {
    const defaultSymbol =
      this.deps.watchedSymbols[0] ?? 'NSE:NIFTY50-INDEX';
    const defaultStyle =
      this.deps.watchedStyles[0] ?? TradingStyle.Intraday;

    const result = await buildRiskRewardTelegramMessage(this.fastify, {
      text,
      defaultSymbol,
      defaultStyle,
    });

    if (result.error) {
      const opts = isFyersAuthError(result.error)
        ? this.fyersAuthReplyOptions(replyChatId)
        : this.replyOptions(replyChatId);
      await this.deps.sendMessage(`⚠️ ${result.error}`, opts);
      return;
    }

    await this.deps.sendMessage(result.message, this.replyOptions(replyChatId));
  }

  private async handlePositionSizing(
    text: string,
    replyChatId?: number,
  ): Promise<void> {
    const defaultSymbol =
      this.deps.watchedSymbols[0] ?? 'NSE:NIFTY50-INDEX';
    const defaultStyle =
      this.deps.watchedStyles[0] ?? TradingStyle.Intraday;

    const result = await buildPositionSizingTelegramMessage(this.fastify, {
      text,
      defaultSymbol,
      defaultStyle,
    });

    if (result.error) {
      const opts = isFyersAuthError(result.error)
        ? this.fyersAuthReplyOptions(replyChatId)
        : this.replyOptions(replyChatId);
      await this.deps.sendMessage(`⚠️ ${result.error}`, opts);
      return;
    }

    await this.deps.sendMessage(result.message, this.replyOptions(replyChatId));
  }

  private async handleLogin(replyChatId?: number): Promise<void> {
    const { text, options } = getFyersLoginReminderContent();
    await this.deps.sendMessage(text, {
      ...this.replyOptions(replyChatId),
      ...options,
    });
  }

  private async handleHelp(_text: string, replyChatId?: number): Promise<void> {
    await this.deps.sendMessage(
      this.helpText(),
      this.replyOptions(replyChatId),
    );
  }

  private async handleStop(replyChatId?: number): Promise<void> {
    if (this.fastify.telegramNotifications.isAlertsPaused()) {
      await this.deps.sendMessage(
        joinTelegramSections(
          '⏸ Already paused',
          joinTelegramLines(
            'No signal or pre-session pings.',
            'TP/hold nudges and commands still work.',
            'Resume with <code>/start</code> or <code>/login</code>.',
          ),
        ),
        this.replyOptions(replyChatId),
      );
      return;
    }

    await this.fastify.telegramNotifications.setAlertsPaused(true);
    await this.deps.sendMessage(
      joinTelegramSections(
        '⏸ <b>Signal alerts paused</b>',
        joinTelegramLines(
          'No signal flips or pre-session briefs until you resume.',
          'TP/hold nudges and commands still work.',
        ),
        'Resume: <code>/start</code> or <code>/login</code>',
      ),
      this.replyOptions(replyChatId),
    );
  }

  private async handleStart(replyChatId?: number): Promise<void> {
    if (!this.fastify.telegramNotifications.isAlertsPaused()) {
      await this.deps.sendMessage(
        '▶️ Alerts already active — nothing to resume. Cheat sheet: <code>/help</code>',
        this.replyOptions(replyChatId),
      );
      return;
    }

    const sessionReady = await this.fastify.ensureFyersSession({
      verifyWithApi: true,
    });
    if (!sessionReady) {
      await this.deps.sendMessage(
        joinTelegramSections(
          '⚠️ Can’t resume yet — Fyers session isn’t live.',
          'Log in first, then alerts turn back on automatically.',
        ),
        this.fyersAuthReplyOptions(replyChatId),
      );
      return;
    }

    await this.fastify.telegramNotifications.setAlertsPaused(false);
    await this.deps.sendMessage(
      joinTelegramSections(
        '▶️ <b>Signal alerts resumed</b>',
        'You’re back on the watch for flips and pre-session briefs.',
      ),
      this.replyOptions(replyChatId),
    );
  }

  private async handleStatus(replyChatId?: number): Promise<void> {
    const status = await this.fastify.telegramNotifications.getStatus();
    const voice = this.fastify.telegramNotifications.getVoice();
    await this.deps.sendMessage(
      formatTelegramStatusMessage(status, voice),
      this.replyOptions(replyChatId),
    );
  }

  private async handleNow(text: string, replyChatId?: number): Promise<void> {
    const result = await buildNowTelegramMessage(this.fastify, {
      text,
      watchedSymbols: this.deps.watchedSymbols,
      watchedStyles: this.deps.watchedStyles,
      isAlertsPaused: this.fastify.telegramNotifications.isAlertsPaused(),
      voice: this.fastify.telegramNotifications.getVoice(),
    });

    if (result.error) {
      const opts = isFyersAuthError(result.error)
        ? this.fyersAuthReplyOptions(replyChatId)
        : this.replyOptions(replyChatId);
      await this.deps.sendMessage(`⚠️ ${result.error}`, opts);
      return;
    }

    const deckOpts =
      result.deckSymbol && result.deckStyle
        ? mergeDeckKeyboard(this.replyOptions(replyChatId), {
            symbol: result.deckSymbol,
            tradingStyle: result.deckStyle,
            includeReplay: true,
          })
        : this.replyOptions(replyChatId);
    let finalMessage = result.message;
    if (result.openPositionNote) {
      finalMessage = `${result.message}\n\n📌 ${result.openPositionNote}`;
    }
    if (result.managementAdvice?.headline) {
      finalMessage += `\n\n🧠 Management: ${result.managementAdvice.headline}`;
    }
    await this.deps.sendMessage(finalMessage, deckOpts);
  }

  private async handleWhy(text: string, replyChatId?: number): Promise<void> {
    const defaultSymbol =
      this.deps.watchedSymbols[0] ?? 'NSE:NIFTY50-INDEX';
    const defaultStyle =
      this.deps.watchedStyles[0] ?? TradingStyle.Intraday;

    const resolved = await resolveWhyContext(this.fastify, {
      text,
      defaultSymbol,
      defaultStyle,
      getExactStrikeForKey: this.deps.getExactStrikeForKey,
    });

    if (resolved.error) {
      const opts = isFyersAuthError(resolved.error)
        ? this.fyersAuthReplyOptions(replyChatId)
        : this.replyOptions(replyChatId);
      await this.deps.sendMessage(`⚠️ ${resolved.error}`, opts);
      return;
    }

    if (!resolved.why) {
      await this.deps.sendMessage(
        '📭 Nothing to explain yet. Try <code>/why live</code> during market hours (Fyers logged in).',
        this.replyOptions(replyChatId),
      );
      return;
    }

    let adaptive: AdaptiveConvictionInsight | undefined =
      resolved.adaptiveConviction;
    if (
      !adaptive &&
      (resolved.why.action === 'CE-BUY' || resolved.why.action === 'PE-BUY')
    ) {
      adaptive = await computeAdaptiveConviction(this.fastify, {
        symbol: resolved.why.symbol,
        tradingStyle: resolved.why.tradingStyle,
        action: resolved.why.action,
      });
    }

    const message = formatWhyAlertMessage({
      why: resolved.why,
      exactStrike: resolved.exactStrike,
      adaptive,
      structureContext: resolved.structureContext,
      voice: this.fastify.telegramNotifications.getVoice(),
    });
    await this.deps.sendMessage(message, this.replyOptions(replyChatId));
  }

  private async handleFyersUsage(replyChatId?: number): Promise<void> {
    const stats = this.fastify.fyersUsage.getStats();
    await this.deps.sendMessage(
      formatFyersUsageTelegramMessage(stats),
      this.replyOptions(replyChatId),
    );
  }

  private async handleBestStrike(
    text: string,
    replyChatId?: number,
  ): Promise<void> {
    const defaultSymbol =
      this.deps.watchedSymbols[0] ?? 'NSE:NIFTY50-INDEX';
    const defaultStyle =
      this.deps.watchedStyles[0] ?? TradingStyle.Intraday;

    const result = await buildBestStrikeTelegramMessage(this.fastify, {
      text,
      defaultSymbol,
      defaultStyle,
    });

    if (result.error) {
      const opts = isFyersAuthError(result.error)
        ? this.fyersAuthReplyOptions(replyChatId)
        : this.replyOptions(replyChatId);
      await this.deps.sendMessage(`⚠️ ${result.error}`, opts);
      return;
    }

    await this.deps.sendMessage(result.message, this.replyOptions(replyChatId));
  }

  private async handleNewsFeed(
    text: string,
    replyChatId?: number,
  ): Promise<void> {
    const parsed = parseNewsFeedCommandArgs(text);

    if (parsed.action !== 'status') {
      const feedId = await this.fastify.telegramNotifications.setNewsFeed(
        parsed.action,
      );
      const feed = getNewsFeedOption(feedId);
      await this.deps.sendMessage(
        joinTelegramSections(
          `✅ <b>News feed → ${feed.label}</b>`,
          `<i>${feed.description}</i>`,
          '<i>Use <code>/news</code> to fetch headlines from this feed.</i>',
        ),
        this.replyOptions(replyChatId),
      );
      return;
    }

    await this.deps.sendMessage(
      formatNewsFeedStatusMessage(
        this.fastify.telegramNotifications.getNewsFeed(),
      ),
      this.replyOptions(replyChatId),
    );
  }

  private async handleNews(text: string, replyChatId?: number): Promise<void> {
    const result = await buildNewsTelegramMessage(this.fastify, {
      text,
      voice: this.fastify.telegramNotifications.getVoice(),
    });

    if (result.error) {
      await this.deps.sendMessage(
        `⚠️ ${result.error}`,
        this.replyOptions(replyChatId),
      );
      return;
    }

    await this.deps.sendMessage(result.message, this.replyOptions(replyChatId));
  }

  private async handleLearning(
    text: string,
    replyChatId?: number,
  ): Promise<void> {
    const result = await buildLearningTelegramMessage(this.fastify, {
      text,
      watchedSymbols: this.deps.watchedSymbols,
      watchedStyles: this.deps.watchedStyles,
      voice: this.fastify.telegramNotifications.getVoice(),
    });

    if (result.error) {
      const opts = isFyersAuthError(result.error)
        ? this.fyersAuthReplyOptions(replyChatId)
        : this.replyOptions(replyChatId);
      await this.deps.sendMessage(`⚠️ ${result.error}`, opts);
      return;
    }

    await this.deps.sendMessage(result.message, this.replyOptions(replyChatId));
  }

  private async handleCoach(text: string, replyChatId?: number): Promise<void> {
    if (this.coachInFlight) {
      await this.deps.sendMessage(
        '⏳ Coach is already running — hang tight.',
        this.replyOptions(replyChatId),
      );
      return;
    }

    this.coachInFlight = true;
    this.deps.onCoachCommandBegin?.();

    try {
      const reply = this.replyOptions(replyChatId);
      const sessionReady = await this.fastify.ensureFyersSession({
        verifyWithApi: true,
      });
      if (!sessionReady) {
        await this.deps.sendMessage(
          FYERS_AUTH_ERROR_REPLY,
          this.fyersAuthReplyOptions(replyChatId),
        );
        return;
      }

      const { sessionDate, styleFilter } = parseCoachCommandArgs(text);
      const snapshots = (await this.deps.loadSnapshots?.()) ?? [];

      const message = await buildCoachTelegramMessage(this.fastify, {
        watchedSymbols: this.deps.watchedSymbols,
        watchedStyles: this.deps.watchedStyles,
        snapshots,
        styleFilter,
        sessionDate,
        voice: this.fastify.telegramNotifications.getVoice(),
      });

      if (message === FYERS_AUTH_ERROR_REPLY) {
        await this.deps.sendMessage(
          message,
          this.fyersAuthReplyOptions(replyChatId),
        );
        return;
      }

      const coachSymbol =
        this.deps.watchedSymbols[0] ?? 'NSE:NIFTY50-INDEX';
      const coachStyle = String(
        styleFilter ??
          this.deps.watchedStyles[0] ??
          TradingStyle.Intraday,
      );
      await this.deps.sendMessage(
        message,
        mergeDeckKeyboard(reply, {
          symbol: coachSymbol,
          tradingStyle: coachStyle,
          sessionDate,
          includeReplay: true,
        }),
      );
      await this.deps.onCoachCommandComplete?.(sessionDate);
    } finally {
      this.coachInFlight = false;
      this.deps.onCoachCommandEnd?.();
    }
  }

  private async handleBenchmark(
    text: string,
    replyChatId?: number,
  ): Promise<void> {
    if (this.benchmarkInFlight) {
      await this.deps.sendMessage(
        '⏳ Benchmark is already running — this can take a minute.',
        this.replyOptions(replyChatId),
      );
      return;
    }

    this.benchmarkInFlight = true;
    try {
      const sessionReady = await this.fastify.ensureFyersSession({
        verifyWithApi: true,
      });
      if (!sessionReady) {
        await this.deps.sendMessage(
          FYERS_AUTH_ERROR_REPLY,
          this.fyersAuthReplyOptions(replyChatId),
        );
        return;
      }

      const defaultSymbol =
        this.deps.watchedSymbols[0] ?? 'NSE:NIFTY50-INDEX';
      const defaultStyle =
        this.deps.watchedStyles[0] ?? TradingStyle.Intraday;

      const result = await buildBenchmarkTelegramMessage(this.fastify, {
        text,
        defaultSymbol,
        defaultStyle,
      });

      if (result.error) {
        const opts = isFyersAuthError(result.error)
          ? this.fyersAuthReplyOptions(replyChatId)
          : this.replyOptions(replyChatId);
        await this.deps.sendMessage(`⚠️ ${result.error}`, opts);
        return;
      }

      const reportUrl =
        result.reportUrl ??
        buildBenchmarkWebAppUrl({
          symbol: defaultSymbol,
          tradingStyle: String(defaultStyle),
        });

      const sendOpts: TelegramSendOptions = {
        ...this.replyOptions(replyChatId),
        inlineKeyboard: reportUrl
          ? [[{ text: '📊 Visual report', webAppUrl: reportUrl }]]
          : undefined,
      };
      await this.deps.sendMessage(result.message, sendOpts);
    } finally {
      this.benchmarkInFlight = false;
    }
  }

  private async handleOutcomes(replyChatId?: number): Promise<void> {
    const records = await loadSignalOutcomes(this.fastify, 12);
    await this.deps.sendMessage(
      formatSignalOutcomesSummary(records),
      this.replyOptions(replyChatId),
    );
  }

  private async handleConviction(text: string, replyChatId?: number): Promise<void> {
    const parts = text.split(/\s+/).filter(Boolean);
    const symbol =
      this.deps.watchedSymbols[0] ?? 'NSE:NIFTY50-INDEX';
    const style = this.deps.watchedStyles[0] ?? TradingStyle.Intraday;
    const action =
      parts[1]?.toUpperCase() === 'PE' ? 'PE-BUY' : 'CE-BUY';

    const styleArg = parts[3]?.toUpperCase();
    let tradingStyle: TradingStyle = style;
    if (styleArg === TradingStyle.Scalper) tradingStyle = TradingStyle.Scalper;
    else if (styleArg === TradingStyle.Positional) {
      tradingStyle = TradingStyle.Positional;
    } else if (styleArg === TradingStyle.Intraday) {
      tradingStyle = TradingStyle.Intraday;
    }

    const insight = await computeAdaptiveConviction(this.fastify, {
      symbol: parts[2]?.includes(':') ? parts[2] : symbol,
      tradingStyle,
      action,
    });

    const bucketLines = insight.buckets
      .filter((b) => b.samples > 0)
      .map(
        (b) =>
          `• ${b.rangeLabel}%: ${b.winRate}% win rate (${b.samples} samples)`,
      )
      .join('\n');

    await this.deps.sendMessage(
      joinTelegramSections(
        '📈 <b>Your enter bar (from past alerts)</b>',
        insight.summary,
        joinTelegramLines(
          `📏 Factory default: ${insight.defaultEnterThreshold}%`,
          `🎯 <b>Your sweet spot:</b> ${insight.recommendedEnterThreshold}%`,
          insight.overallWinRate != null
            ? `🏆 Win rate: ${insight.overallWinRate}% across ${insight.sampleSize} closed alerts`
            : `📊 Samples so far: ${insight.sampleSize}`,
        ),
        bucketLines
          ? joinTelegramLines('📊 <b>By conviction bucket</b>', bucketLines)
          : null,
      ),
      this.replyOptions(replyChatId),
    );
  }

  private async handleStyle(text: string, replyChatId?: number): Promise<void> {
    const parsed = parseStyleCommandArgs(text);

    if (parsed.action !== 'status') {
      const style = await this.fastify.telegramNotifications.setTradingStyle(
        parsed.action,
      );
      const label = tradingStyleLabel(style);
      await this.deps.sendMessage(
        joinTelegramSections(
          `✅ <b>Trading style → ${label}</b>`,
          '<i>Alerts, /now, deck, and coach now use this style.</i>',
          '<i>Use <code>/style status</code> for details.</i>',
        ),
        this.replyOptions(replyChatId),
      );
      return;
    }

    await this.deps.sendMessage(
      formatStyleStatusMessage(
        this.fastify.telegramNotifications.getTradingStyle(),
      ),
      this.replyOptions(replyChatId),
    );
  }

  private async handleFlow(text: string, replyChatId?: number): Promise<void> {
    const parsed = parseFlowCommandArgs(text);

    if (parsed.action !== 'status') {
      await this.fastify.telegramNotifications.setFlowMode(parsed.action);
      const labels: Record<string, string> = {
        blend:
          '✅ <b>Flow mode BLEND</b>\nConviction uses price action + option flow (default).',
        'pa-only':
          '📊 <b>Flow mode PA</b>\nPrice action only — option score ignored.',
        'option-only':
          '📈 <b>Flow mode OPTION</b>\nOption flow only — PA ignored for the blend.',
      };
      await this.deps.sendMessage(
        joinTelegramSections(
          labels[parsed.action] ?? formatFlowStatusMessage(parsed.action),
          '<i>Use <code>/flow status</code> for details.</i>',
        ),
        this.replyOptions(replyChatId),
      );
      return;
    }

    await this.deps.sendMessage(
      formatFlowStatusMessage(this.fastify.telegramNotifications.getFlowMode()),
      this.replyOptions(replyChatId),
    );
  }

  private async handleVeto(text: string, replyChatId?: number): Promise<void> {
    const parsed = parseVetoCommandArgs(text);

    if (parsed.action !== 'status') {
      await this.fastify.telegramNotifications.setVetoMode(parsed.action);
      const labels: Record<string, string> = {
        strict: '✅ <b>Veto mode STRICT</b>\nFull chart vetoes and option gates are active.',
        relaxed:
          '🟡 <b>Veto mode RELAXED</b>\nHard decay still blocks; soft decay and option conflict are eased.',
        off: '⚠️ <b>Veto mode OFF</b>\nChart vetoes bypassed for /now, alerts, and deck.',
      };
      await this.deps.sendMessage(
        joinTelegramSections(
          labels[parsed.action] ?? formatVetoStatusMessage(parsed.action),
          '<i>Use <code>/veto status</code> for details.</i>',
        ),
        this.replyOptions(replyChatId),
      );
      return;
    }

    await this.deps.sendMessage(
      formatVetoStatusMessage(this.fastify.telegramNotifications.getVetoMode()),
      this.replyOptions(replyChatId),
    );
  }

  private async handleAlert(text: string, replyChatId?: number): Promise<void> {
    const parsed = parseAlertCommandArgs(text);

    if (parsed.action !== 'status') {
      const alertFormat =
        await this.fastify.telegramNotifications.setAlertFormat(parsed.action);
      const label = alertFormatLabel(alertFormat);
      await this.deps.sendMessage(
        joinTelegramSections(
          `✅ <b>Alert format → ${label}</b>`,
          alertFormat === 'compact'
            ? '<i>Signal pings stay short — open Deck for PA, flow, Greeks, and playbook.</i>'
            : '<i>Signal pings include full PA, structure, Greeks, and playbook in chat.</i>',
          '<i>Use <code>/alert status</code> for details.</i>',
        ),
        this.replyOptions(replyChatId),
      );
      return;
    }

    await this.deps.sendMessage(
      formatAlertStatusMessage(
        this.fastify.telegramNotifications.getAlertFormat(),
      ),
      this.replyOptions(replyChatId),
    );
  }

  private async handleVoice(text: string, replyChatId?: number): Promise<void> {
    const parsed = parseVoiceCommandArgs(text);

    if (parsed.action === 'preview') {
      await this.deps.sendMessage(
        formatVoicePreviewMessage(),
        this.replyOptions(replyChatId),
      );
      return;
    }

    if (parsed.action === 'set' && parsed.voice) {
      const voice = await this.fastify.telegramNotifications.setVoice(
        parsed.voice,
      );
      await this.deps.sendMessage(
        joinTelegramSections(
          '✅ <b>Voice updated</b>',
          `Alerts will now sound like: <b>${voiceDisplayName(voice)}</b>`,
          '<i>Signals, TP, /now, /why, /status, /learning, /coach, and session briefs use this voice.</i>',
        ),
        this.replyOptions(replyChatId),
      );
      return;
    }

    await this.deps.sendMessage(
      formatVoiceStatusMessage(this.fastify.telegramNotifications.getVoice()),
      this.replyOptions(replyChatId),
    );
  }

  private async handleAi(text: string, replyChatId?: number): Promise<void> {
    const parsed = parseAiCommandArgs(text);
    const state = this.fastify.telegramNotifications.getAiBeta();

    if (parsed.action === 'toggle' && parsed.value) {
      const enabled = parsed.value === 'on';
      await this.fastify.telegramNotifications.setAiBeta({ enabled });
      await this.deps.sendMessage(
        joinTelegramSections(
          `✅ <b>AI Agent → ${enabled ? 'Enabled' : 'Disabled'}</b>`,
          `<i>AI analysis is now ${enabled ? 'active' : 'off'}.</i>`,
        ),
        this.replyOptions(replyChatId),
      );
      return;
    }

    if (parsed.action === 'provider' && parsed.value) {
      const provider = parsed.value.toUpperCase() as AIProvider;
      await this.fastify.telegramNotifications.setAiBeta({ provider });
      await this.deps.sendMessage(
        joinTelegramSections(
          `✅ <b>AI Provider → ${provider}</b>`,
          `<i>Model switched to ${provider}.</i>`,
        ),
        this.replyOptions(replyChatId),
      );
      return;
    }

    if (parsed.action === 'shadow' && parsed.value) {
      const shadowMode = parsed.value === 'on';
      await this.fastify.telegramNotifications.setAiBeta({ shadowMode });
      await this.deps.sendMessage(
        joinTelegramSections(
          `✅ <b>AI Shadow Mode → ${shadowMode ? 'On' : 'Off'}</b>`,
          `<i>${shadowMode ? 'Opinion only mode enabled.' : 'AI will now influence the conviction score.'}</i>`,
        ),
        this.replyOptions(replyChatId),
      );
      return;
    }

    await this.deps.sendMessage(
      formatAiStatusMessage(state),
      this.replyOptions(replyChatId),
    );
  }
}