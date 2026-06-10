import {
  TelegramAlertChannel,
  TelegramAlertChannelConfig,
  TelegramSendOptions,
} from '../types/telegram-notifications';

const CHANNELS: TelegramAlertChannel[] = [
  'signal',
  'tp',
  'coach',
  'test',
  'default',
];

function envChatId(name: string): string {
  return process.env[name]?.trim() || '';
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === '') return fallback;
  return raw === 'true' || raw === '1' || raw === 'yes';
}

export function resolveTelegramChatId(
  channel: TelegramAlertChannel,
  fallbackChatId: string,
): string {
  const dedicated: Partial<Record<TelegramAlertChannel, string>> = {
    signal: envChatId('TELEGRAM_CHAT_ID_SIGNAL'),
    tp: envChatId('TELEGRAM_CHAT_ID_TP'),
    coach: envChatId('TELEGRAM_CHAT_ID_COACH'),
    test: envChatId('TELEGRAM_CHAT_ID_TEST'),
    default: fallbackChatId,
  };

  return dedicated[channel] || fallbackChatId;
}

export function isSilentChannel(channel: TelegramAlertChannel): boolean {
  const defaults: Record<TelegramAlertChannel, boolean> = {
    signal: false,
    tp: false,
    coach: envBool('TELEGRAM_NOTIFY_SILENT_COACH', false),
    test: false,
    default: false,
  };
  return defaults[channel];
}

export function resolveSendParams(
  fallbackChatId: string,
  options?: TelegramSendOptions,
): { chatId: string; disableNotification: boolean; channel: TelegramAlertChannel } {
  const channel = options?.channel ?? 'default';
  const chatId = resolveTelegramChatId(channel, fallbackChatId);
  const disableNotification =
    options?.disableNotification ?? isSilentChannel(channel);
  return { chatId, disableNotification, channel };
}

export function buildAlertChannelStatus(
  fallbackChatId: string,
): TelegramAlertChannelConfig[] {
  return CHANNELS.filter((c) => c !== 'default').map((channel) => {
    const dedicated = resolveTelegramChatId(channel, '');
    const fallback = fallbackChatId;
    const chatId = dedicated || fallback;
    return {
      channel,
      chatIdConfigured: Boolean(chatId),
      usesDedicatedChat: Boolean(dedicated),
      silentByDefault: isSilentChannel(channel),
    };
  });
}

export const TELEGRAM_SOUND_ROUTING_NOTE =
  'Telegram bots cannot set custom sounds per message. Use TELEGRAM_CHAT_ID_SIGNAL / _TP / _COACH for separate chats, then assign different notification sounds per chat in your phone Telegram settings. Use TELEGRAM_NOTIFY_SILENT_COACH=true for silent coach messages.';