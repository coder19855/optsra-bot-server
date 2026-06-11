/** How auto-alerts and TP coach copy are phrased in Telegram. */
export type TelegramVoice = 'trader' | 'simple' | 'tapori' | 'marathi';

export const TELEGRAM_VOICES: readonly TelegramVoice[] = [
  'trader',
  'simple',
  'tapori',
  'marathi',
] as const;

export const DEFAULT_TELEGRAM_VOICE: TelegramVoice = 'trader';