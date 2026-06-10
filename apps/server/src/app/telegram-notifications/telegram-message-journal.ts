import axios from 'axios';
import { TELEGRAM_API_BASE } from '../constants/telegram-notifications';

const MAX_TRACKED_PER_CHAT = 250;
/** How many message IDs to scan backward from /clear (Telegram ids are sequential per chat). */
const DEFAULT_CLEAR_SCAN_BACK = 400;

interface TrackedMessage {
  messageId: number;
  sentAt: number;
}

export class TelegramMessageJournal {
  private readonly byChat = new Map<string, TrackedMessage[]>();

  record(chatId: string | number, messageId: number): void {
    const key = String(chatId);
    const list = this.byChat.get(key) ?? [];
    list.push({ messageId, sentAt: Date.now() });
    while (list.length > MAX_TRACKED_PER_CHAT) {
      list.shift();
    }
    this.byChat.set(key, list);
  }

  trackedCount(chatId: string | number): number {
    return this.byChat.get(String(chatId))?.length ?? 0;
  }

  maxMessageId(chatId: string | number): number | null {
    const list = this.byChat.get(String(chatId)) ?? [];
    if (!list.length) return null;
    return Math.max(...list.map((item) => item.messageId));
  }

  forget(chatId: string | number, messageId: number): void {
    const key = String(chatId);
    const list = this.byChat.get(key);
    if (!list) return;
    const index = list.findIndex((item) => item.messageId === messageId);
    if (index >= 0) list.splice(index, 1);
  }
}

export async function deleteTelegramChatMessage(params: {
  botToken: string;
  chatId: string | number;
  messageId: number;
}): Promise<boolean> {
  try {
    const url = `${TELEGRAM_API_BASE}/bot${params.botToken}/deleteMessage`;
    await axios.post(url, {
      chat_id: params.chatId,
      message_id: params.messageId,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Walk backward through sequential Telegram message IDs and delete bot-owned messages.
 */
export async function clearBotMessagesByScan(params: {
  botToken: string;
  journal: TelegramMessageJournal;
  chatId: number;
  anchorMessageId: number;
  limit?: number;
  scanBack?: number;
}): Promise<{ deleted: number; scanned: number }> {
  const scanBack = params.scanBack ?? DEFAULT_CLEAR_SCAN_BACK;
  const maxDeletes = params.limit ?? Number.POSITIVE_INFINITY;

  const journalMax = params.journal.maxMessageId(params.chatId);
  const startId = Math.max(params.anchorMessageId, journalMax ?? params.anchorMessageId);

  let deleted = 0;
  let scanned = 0;

  for (let offset = 1; offset <= scanBack && deleted < maxDeletes; offset += 1) {
    const messageId = startId - offset;
    if (messageId <= 0) break;

    scanned += 1;
    const ok = await deleteTelegramChatMessage({
      botToken: params.botToken,
      chatId: params.chatId,
      messageId,
    });
    if (ok) {
      deleted += 1;
      params.journal.forget(params.chatId, messageId);
    }
  }

  return { deleted, scanned };
}

export function parseClearCommandLimit(text: string): number | undefined {
  const parts = text.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return undefined;
  const raw = parts[1];
  if (!/^\d+$/.test(raw)) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.min(100, Math.floor(n));
}