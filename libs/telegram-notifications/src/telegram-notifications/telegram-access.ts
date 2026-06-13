function parseCsvIds(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => /^\d+$/.test(part));
}

/**
 * Telegram user IDs allowed to run bot commands.
 * Falls back to TELEGRAM_CHAT_ID for private 1:1 bots (chat id === user id).
 */
export function resolveAllowedTelegramUserIds(
  fallbackChatId?: string,
): Set<string> {
  const explicit = parseCsvIds(process.env.TELEGRAM_ALLOWED_USER_IDS);
  if (explicit.length > 0) return new Set(explicit);

  const chatId = fallbackChatId?.trim() || process.env.TELEGRAM_CHAT_ID?.trim();
  if (chatId && /^\d+$/.test(chatId)) {
    return new Set([chatId]);
  }

  return new Set();
}

export function isTelegramUserAllowed(
  userId: number | undefined,
  allowedUserIds: Set<string>,
): boolean {
  if (!allowedUserIds.size || userId == null) return false;
  return allowedUserIds.has(String(userId));
}