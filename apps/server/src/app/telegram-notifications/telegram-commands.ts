import axios from 'axios';
import { FastifyInstance } from 'fastify';
import { TELEGRAM_API_BASE } from '../constants/telegram-notifications';
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
import { buildLearningTelegramMessage } from './session-learning';
import { parseClearCommandLimit } from './telegram-message-journal';

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
}

export class TelegramCommandPoller {
  private offset = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

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

  start(intervalMs = 5000): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.pollOnce();
    }, intervalMs);
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
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  private async pollOnce(): Promise<void> {
    if (!this.deps.botToken) return;

    try {
      const url = `${TELEGRAM_API_BASE}/bot${this.deps.botToken}/getUpdates`;
      const res = await axios.get(url, {
        params: { offset: this.offset, timeout: 0, limit: 20 },
      });

      const updates = (res.data?.result ?? []) as TelegramUpdate[];
      for (const update of updates) {
        this.offset = update.update_id + 1;
        await this.handleUpdate(update);
      }
    } catch (err) {
      this.fastify.log.debug({ err }, 'Telegram command poll failed');
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

    try {
      if (command === '/why') {
        await this.handleWhy(text, replyChatId);
      } else if (command === '/coach') {
        await this.handleCoach(text, replyChatId);
      } else if (command === '/learning') {
        await this.handleLearning(text, replyChatId);
      } else if (command === '/best-strike' || command === '/beststrike') {
        await this.handleBestStrike(text, replyChatId);
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
        await this.handleHelp('/help', replyChatId);
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

    let adaptive: AdaptiveConvictionInsight | undefined;
    if (
      resolved.why.action === 'CE-BUY' ||
      resolved.why.action === 'PE-BUY'
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
    });
    await this.deps.sendMessage(message, this.replyOptions(replyChatId));
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

  private async handleLearning(
    text: string,
    replyChatId?: number,
  ): Promise<void> {
    const result = await buildLearningTelegramMessage(this.fastify, {
      text,
      watchedSymbols: this.deps.watchedSymbols,
      watchedStyles: this.deps.watchedStyles,
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
    });

    if (message === FYERS_AUTH_ERROR_REPLY) {
      await this.deps.sendMessage(
        message,
        this.fyersAuthReplyOptions(replyChatId),
      );
      return;
    }

    await this.deps.sendMessage(message, reply);
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
      [
        '📈 <b>Your enter bar (from past alerts)</b>',
        insight.summary,
        '',
        `📏 Factory default: ${insight.defaultEnterThreshold}%`,
        `🎯 <b>Your sweet spot:</b> ${insight.recommendedEnterThreshold}%`,
        insight.overallWinRate != null
          ? `🏆 Win rate: ${insight.overallWinRate}% across ${insight.sampleSize} closed alerts`
          : `📊 Samples so far: ${insight.sampleSize}`,
        bucketLines ? `\n<b>By conviction bucket</b>\n${bucketLines}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      this.replyOptions(replyChatId),
    );
  }
}