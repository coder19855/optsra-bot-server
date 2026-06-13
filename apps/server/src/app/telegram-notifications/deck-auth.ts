import crypto from 'crypto';
import { FastifyRequest } from 'fastify';

const MAX_AUTH_AGE_SEC = 86_400;

export function parseTelegramInitData(
  initData: string,
): Record<string, string> {
  const params = new URLSearchParams(initData);
  const out: Record<string, string> = {};
  for (const [key, value] of params.entries()) {
    out[key] = value;
  }
  return out;
}

export function validateTelegramWebAppInitData(
  initData: string,
  botToken: string,
  nowSec = Math.floor(Date.now() / 1000),
): { ok: boolean; userId?: string; reason?: string } {
  if (!initData?.trim()) {
    return { ok: false, reason: 'missing_init_data' };
  }
  if (!botToken?.trim()) {
    return { ok: false, reason: 'missing_bot_token' };
  }

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return { ok: false, reason: 'missing_hash' };

  const pairs: string[] = [];
  for (const [key, value] of params.entries()) {
    if (key === 'hash') continue;
    pairs.push(`${key}=${value}`);
  }
  pairs.sort((a, b) => a.localeCompare(b));
  const dataCheckString = pairs.join('\n');

  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(botToken)
    .digest();
  const calculated = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  if (calculated !== hash) {
    return { ok: false, reason: 'invalid_hash' };
  }

  const authDate = Number(params.get('auth_date'));
  if (Number.isFinite(authDate) && nowSec - authDate > MAX_AUTH_AGE_SEC) {
    return { ok: false, reason: 'expired_auth' };
  }

  let userId: string | undefined;
  const userRaw = params.get('user');
  if (userRaw) {
    try {
      const user = JSON.parse(userRaw) as { id?: number };
      if (user.id != null) userId = String(user.id);
    } catch {
      return { ok: false, reason: 'invalid_user_payload' };
    }
  }

  return { ok: true, userId };
}

export function isDeckAuthSkipped(): boolean {
  return (
    process.env.DECK_SKIP_TELEGRAM_AUTH === 'true' ||
    process.env.NODE_ENV === 'test'
  );
}