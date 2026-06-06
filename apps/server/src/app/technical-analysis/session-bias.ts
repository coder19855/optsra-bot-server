import { TIMELINE_DEFAULTS } from '../constants/technical-analysis';
import { SessionBias, SessionPhase } from '../types/technical-analysis';

const IST = TIMELINE_DEFAULTS.IST_TIMEZONE;

function getIstMinutes(epochMs: number): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: IST,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(epochMs));

  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return hour * 60 + minute;
}

export function resolveSessionPhase(epochMs: number): SessionPhase {
  const mins = getIstMinutes(epochMs);
  const open =
    TIMELINE_DEFAULTS.SESSION_OPEN.hour * 60 +
    TIMELINE_DEFAULTS.SESSION_OPEN.minute;
  const midday = 11 * 60;
  const closing = 13 * 60 + 30;

  if (mins < open) return 'morning';
  if (mins < midday) return 'morning';
  if (mins < closing) return 'midday';
  return 'closing';
}

/**
 * Session-based bias for intraday NSE.
 * Morning favors breakouts; midday is chop-prone; closing favors trend continuation.
 */
export function analyzeSessionBias(
  epochMs: number,
  score15m: number,
  score1h: number,
): SessionBias {
  const phase = resolveSessionPhase(epochMs);

  let confluenceMultiplier = 1;
  let directionalBias = 0;
  let label = 'Neutral session';

  if (phase === 'morning') {
    confluenceMultiplier = 0.95;
    directionalBias = Math.sign(score15m) * 0.3 + Math.sign(score1h) * 0.2;
    label = 'Morning: breakout window';
  } else if (phase === 'midday') {
    confluenceMultiplier = 1.15;
    directionalBias = 0;
    label = 'Midday: chop filter active';
  } else {
    confluenceMultiplier = 1.05;
    directionalBias = Math.sign(score15m) * 0.4;
    label = 'Closing: continuation bias';
  }

  return {
    phase,
    directionalBias: +directionalBias.toFixed(3),
    confluenceMultiplier,
    label,
  };
}