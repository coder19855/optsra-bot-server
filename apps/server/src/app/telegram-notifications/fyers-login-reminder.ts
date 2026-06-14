import { TelegramSendOptions } from '../types/telegram-notifications';
import { joinTelegramLines, joinTelegramSections } from './message-layout';

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

export function resolveFyersLoginUrl(forceRelogin = false): string | null {
  const base = resolvePublicAppBaseUrl();
  if (!base) return null;
  const qs = new URLSearchParams({ forceRedirect: 'true' });
  if (forceRelogin) qs.set('forceRelogin', 'true');
  return `${base}/api/login?${qs.toString()}`;
}

export function buildFyersLoginInlineKeyboard():
  | TelegramSendOptions['inlineKeyboard']
  | undefined {
  const loginUrl = resolveFyersLoginUrl();
  if (!loginUrl) return undefined;
  return [[{ text: '🔐 Login to Fyers', url: loginUrl }]];
}

export function getFyersLoginAlreadyActiveContent(): {
  text: string;
  options: TelegramSendOptions;
} {
  const refreshUrl = resolveFyersLoginUrl(true);
  const inlineKeyboard = refreshUrl
    ? [[{ text: '🔄 Force refresh token', url: refreshUrl }]]
    : undefined;

  return {
    text: joinTelegramSections(
      '✅ <b>Fyers session is active</b>',
      joinTelegramLines(
        'Your token is valid — no browser login needed.',
        'Alerts, /coach, /benchmark, and live reads can use this session.',
      ),
      joinTelegramLines(
        '<i>Check</i> <code>/status</code> <i>for session details.</i>',
        refreshUrl
          ? '<i>Use refresh only if commands still fail after a valid token.</i>'
          : null,
      ),
    ),
    options: inlineKeyboard ? { inlineKeyboard } : {},
  };
}

export function getFyersLoginApiMismatchContent(): {
  text: string;
  options: TelegramSendOptions;
} {
  const loginUrl = resolveFyersLoginUrl(true);
  const inlineKeyboard = loginUrl
    ? [[{ text: '🔐 Refresh Fyers login', url: loginUrl }]]
    : buildFyersLoginInlineKeyboard();

  return {
    text: joinTelegramSections(
      '⚠️ <b>Fyers token looks valid but API check failed</b>',
      joinTelegramLines(
        'The stored JWT has not expired, but Fyers rejected a live profile call.',
        'Try refresh below — or wait a minute and run <code>/status</code>.',
      ),
    ),
    options: inlineKeyboard ? { inlineKeyboard } : {},
  };
}

export function getFyersLoginReminderContent(): {
  text: string;
  options: TelegramSendOptions;
} {
  const loginUrl = resolveFyersLoginUrl();
  const inlineKeyboard = buildFyersLoginInlineKeyboard();

  const text = loginUrl
    ? joinTelegramSections(
        '🔐 <b>Time to log into Fyers</b>',
        joinTelegramLines(
          'Your ~24h token expired (or never landed).',
          'Alerts, /coach, and live reads need a fresh session.',
        ),
        'Hit the button — opens your <b>browser</b>, through Fyers, then back when you’re done.',
      )
    : joinTelegramSections(
        '🔐 <b>Time to log into Fyers</b>',
        joinTelegramLines(
          'Session’s missing. Set <code>PUBLIC_APP_URL</code> (or <code>FYERS_REDIRECT_URL</code>) so Telegram can link to <code>/api/login</code>.',
          'Then open <code>/api/login?forceRedirect=true</code> in your browser.',
        ),
      );

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