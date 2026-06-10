import { DecisionAction } from '../types/trade-decision';
import { CoachVerdict } from '../types/trading-coach';
import { FyersUsageHealth } from '../types/fyers-usage';
import { TpAlertKind, TpHoldAdvice } from '../types/telegram-notifications';

/** Telegram HTML has no real colours — we use emoji accents + text borders. */
export type TelegramScenario =
  | 'bullish'
  | 'bearish'
  | 'neutral'
  | 'muted'
  | 'gamma'
  | 'pick'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'coach'
  | 'learning'
  | 'api';

export interface PaletteToken {
  /** Callout top/bottom border */
  edge: string;
  /** Title / line emoji */
  accent: string;
}

export const TELEGRAM_PALETTE: Record<TelegramScenario, PaletteToken> = {
  bullish: { edge: '▰▰▰▰▰▰▰▰▰▰▰▰', accent: '📈' },
  bearish: { edge: '▰▰▰▰▰▰▰▰▰▰▰▰', accent: '📉' },
  neutral: { edge: '┉┉┉┉┉┉┉┉┉┉┉┉', accent: '⏸' },
  muted: { edge: '────────────', accent: '💤' },
  gamma: { edge: '▰▰▰▰▰▰▰▰▰▰▰▰', accent: '🤯' },
  pick: { edge: '▰▰▰▰▰▰▰▰▰▰▰▰', accent: '🎯' },
  success: { edge: '▰▰▰▰▰▰▰▰▰▰▰▰', accent: '✅' },
  warning: { edge: '┉┉┉┉┉┉┉┉┉┉┉┉', accent: '⚠️' },
  danger: { edge: '▰▰▰▰▰▰▰▰▰▰▰▰', accent: '🚨' },
  info: { edge: '┈┈┈┈┈┈┈┈┈┈┈┈', accent: 'ℹ️' },
  coach: { edge: '▰▰▰▰▰▰▰▰▰▰▰▰', accent: '📚' },
  learning: { edge: '▰▰▰▰▰▰▰▰▰▰▰▰', accent: '🧠' },
  api: { edge: '▰▰▰▰▰▰▰▰▰▰▰▰', accent: '🌡' },
};

/** Thin divider between sections. */
export function scenarioRule(_scenario: TelegramScenario = 'muted'): string {
  return '┉┉┉┉┉┉┉┉┉┉┉┉';
}

export function paletteToken(scenario: TelegramScenario): PaletteToken {
  return TELEGRAM_PALETTE[scenario];
}

/** Full-width callout card for high-signal blocks. */
export function wrapScenarioCallout(
  scenario: TelegramScenario,
  titleHtml: string,
  bodyLines: string[],
): string {
  const { edge, accent } = TELEGRAM_PALETTE[scenario];
  const body = bodyLines.filter(Boolean);
  return [
    edge,
    `${accent} ${titleHtml}`,
    ...body,
    edge,
  ].join('\n');
}

/** Section header with scenario icon. */
export function formatSectionHeader(
  scenario: TelegramScenario,
  title: string,
  icon?: string,
): string {
  const { accent } = TELEGRAM_PALETTE[scenario];
  const lead = icon ?? accent;
  return `${lead} <b>${title}</b>`;
}

/** Top-of-message scenario banner. */
export function formatScenarioBanner(
  scenario: TelegramScenario,
  headlineHtml: string,
): string {
  const { accent } = TELEGRAM_PALETTE[scenario];
  return `${accent} <b>${headlineHtml}</b>`;
}

/** Prefix a line with a scenario icon — keeps body emojis intact. */
export function tintLine(scenario: TelegramScenario, line: string): string {
  const { accent } = TELEGRAM_PALETTE[scenario];
  return `${accent} ${line}`;
}

/** Free-form icon prefix (when a specific emoji fits better than the palette). */
export function iconLine(icon: string, line: string): string {
  return `${icon} ${line}`;
}

export function scenarioForAction(action: DecisionAction): TelegramScenario {
  if (action === 'CE-BUY') return 'bullish';
  if (action === 'PE-BUY') return 'bearish';
  if (action === 'NEUTRAL') return 'neutral';
  return 'muted';
}

export function scenarioForSignalFlip(): TelegramScenario {
  return 'danger';
}

export function scenarioForTradeReady(ready: boolean): TelegramScenario {
  return ready ? 'success' : 'warning';
}

export function scenarioForCoachVerdict(verdict: CoachVerdict): TelegramScenario {
  if (verdict === 'good') return 'success';
  if (verdict === 'bad') return 'warning';
  return 'danger';
}

export function scenarioForPnl(pnl: number): TelegramScenario {
  if (pnl > 0) return 'success';
  if (pnl < 0) return 'danger';
  return 'muted';
}

export function scenarioForFyersHealth(health: FyersUsageHealth): TelegramScenario {
  if (health === 'critical') return 'danger';
  if (health === 'warning') return 'warning';
  return 'success';
}

export function scenarioForTpKinds(kinds: TpAlertKind[]): TelegramScenario {
  if (kinds.includes('SIGNAL_CONFLICT')) return 'warning';
  if (kinds.includes('REACHED')) return 'success';
  if (kinds.includes('APPROACHING')) return 'info';
  return 'info';
}

export function scenarioForHoldAdvice(advice: TpHoldAdvice): TelegramScenario {
  if (advice === 'hold') return 'success';
  if (advice === 'trail') return 'warning';
  if (advice === 'partial') return 'warning';
  return 'danger';
}

export function scenarioForGammaLevel(
  level: 'high' | 'moderate' | 'low',
): TelegramScenario {
  if (level === 'high') return 'gamma';
  if (level === 'moderate') return 'warning';
  return 'muted';
}