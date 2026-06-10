import { TelegramSendOptions } from '../types/telegram-notifications';

export const FYERS_LOGIN_REMINDER_COOLDOWN_MS = 6 * 60 * 60 * 1000;

export const FYERS_AUTH_ERROR_REPLY =
  '🔐 Fyers session’s asleep — tap <b>Login to Fyers</b> below to wake it up.';

/** Public base URL for links opened from Telegram (browser). */
export function resolvePublicAppBaseUrl(): string | null {
  const explicit =
    process.env.PUBLIC_APP_URL?.trim() ||
    process.env.APP_PUBLIC_URL?.trim() ||
    '';
  if (explicit) return explicit.replace(/\/$/, '');

  const redirect = process.env.FYERS_REDIRECT_URL?.trim() || '';
  if (!redirect) return null;

  try {
    const url = new URL(redirect);
    return url.origin;
  } catch {
    return null;
  }
}

export function resolveFyersLoginUrl(): string | null {
  const base = resolvePublicAppBaseUrl();
  if (!base) return null;
  return `${base}/api/login?forceRedirect=true`;
}

export function buildFyersLoginInlineKeyboard():
  | TelegramSendOptions['inlineKeyboard']
  | undefined {
  const loginUrl = resolveFyersLoginUrl();
  if (!loginUrl) return undefined;
  return [[{ text: '🔐 Login to Fyers', url: loginUrl }]];
}

export function getFyersLoginReminderContent(): {
  text: string;
  options: TelegramSendOptions;
} {
  const loginUrl = resolveFyersLoginUrl();
  const inlineKeyboard = buildFyersLoginInlineKeyboard();

  const text = loginUrl
    ? [
        '🔐 <b>Time to log into Fyers</b>',
        '',
        'Your ~24h token expired (or never landed).',
        'Alerts, /coach, and live reads need a fresh session.',
        '',
        'Hit the button — opens your <b>browser</b>, through Fyers, then back when you’re done.',
      ].join('\n')
    : [
        '🔐 <b>Time to log into Fyers</b>',
        '',
        'Session’s missing. Set <code>PUBLIC_APP_URL</code> (or <code>FYERS_REDIRECT_URL</code>) so Telegram can link to <code>/api/login</code>.',
        '',
        'Then open <code>/api/login?forceRedirect=true</code> in your browser.',
      ].join('\n');

  return {
    text,
    options: inlineKeyboard ? { inlineKeyboard } : {},
  };
}

export function shouldSendFyersLoginReminder(
  lastSentAt: Date | null,
  now = Date.now(),
): boolean {
  if (!lastSentAt) return true;
  return now - lastSentAt.getTime() >= FYERS_LOGIN_REMINDER_COOLDOWN_MS;
}