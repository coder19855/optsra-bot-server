/** Turn unknown thrown values (incl. Fyers `{ s, code, message }`) into user-facing text. */
export function toErrorMessage(err: unknown): string {
  if (err == null) return 'Unknown error';

  if (typeof err === 'string') {
    const trimmed = err.trim();
    return trimmed || 'Unknown error';
  }

  if (typeof err === 'number' || typeof err === 'boolean' || typeof err === 'bigint') {
    return String(err);
  }

  if (err instanceof Error) {
    const message = err.message;
    if (typeof message === 'string' && message.trim()) {
      return message.trim();
    }
    return toErrorMessage({ message: err.name || 'Error' });
  }

  if (typeof err === 'object') {
    const record = err as Record<string, unknown>;

    if (typeof record.message === 'string' && record.message.trim()) {
      const code = record.code;
      if (code != null && String(code).trim()) {
        return `${code}: ${record.message.trim()}`;
      }
      return record.message.trim();
    }

    if (typeof record.error === 'string' && record.error.trim()) {
      return record.error.trim();
    }

    if (typeof record.reason === 'string' && record.reason.trim()) {
      return record.reason.trim();
    }

    try {
      return JSON.stringify(err);
    } catch {
      return 'Unknown error';
    }
  }

  return String(err);
}