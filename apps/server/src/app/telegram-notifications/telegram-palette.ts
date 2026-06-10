import { DecisionAction } from '../types/trade-decision';
import { CoachVerdict } from '../types/trading-coach';
import { FyersUsageHealth } from '../types/fyers-usage';
import { TpAlertKind, TpHoldAdvice } from '../types/telegram-notifications';

/** Telegram HTML has no real colours — we use a fixed emoji + border palette. */
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
  /** Colour square — scan anchor */
  dot: string;
  /** Callout top/bottom border */
  edge: string;
  /** Title emoji */
  accent: string;
}

export const TELEGRAM_PALETTE: Record<TelegramScenario, PaletteToken> = {
  bullish: { dot: '🟢', edge: '🟢▰▰▰▰▰▰▰▰▰▰▰▰🟢', accent: '📈' },
  bearish: { dot: '🔴', edge: '🔴▰▰▰▰▰▰▰▰▰▰▰▰🔴', accent: '📉' },
  neutral: { dot: '🟡', edge: '🟡┉┉┉┉┉┉┉┉┉┉┉┉🟡', accent: '⏸' },
  muted: { dot: '⚪', edge: '⚪────────────⚪', accent: '💤' },
  gamma: { dot: '🟠', edge: '🟠▰▰▰▰▰▰▰▰▰▰▰▰🟠', accent: '🤯' },
  pick: { dot: '🔵', edge: '🔵▰▰▰▰▰▰▰▰▰▰▰▰🔵', accent: '🎯' },
  success: { dot: '🟢', edge: '🟢▰▰▰▰▰▰▰▰▰▰▰▰🟢', accent: '✅' },
  warning: { dot: '🟡', edge: '🟡┉┉┉┉┉┉┉┉┉┉┉┉🟡', accent: '⚠️' },
  danger: { dot: '🔴', edge: '🔴▰▰▰▰▰▰▰▰▰▰▰▰🔴', accent: '🚨' },
  info: { dot: '🔵', edge: '🔵┈┈┈┈┈┈┈┈┈┈┈┈🔵', accent: 'ℹ️' },
  coach: { dot: '🟣', edge: '🟣▰▰▰▰▰▰▰▰▰▰▰▰🟣', accent: '📚' },
  learning: { dot: '🟧', edge: '🟧▰▰▰▰▰▰▰▰▰▰▰▰🟧', accent: '🧠' },
  api: { dot: '🟦', edge: '🟦▰▰▰▰▰▰▰▰▰▰▰▰🟦', accent: '🌡' },
};

/** Thin divider between sections (scenario-tinted). */
export function scenarioRule(scenario: TelegramScenario = 'muted'): string {
  const { dot } = TELEGRAM_PALETTE[scenario];
  return `${dot}${'─'.repeat(11)}${dot}`;
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
  const { edge, dot, accent } = TELEGRAM_PALETTE[scenario];
  const body = bodyLines.filter(Boolean);
  return [
    edge,
    `${dot} ${accent} ${titleHtml}`,
    ...body,
    edge,
  ].join('\n');
}

/** Section header with colour dot + scenario icon (never strip these). */
export function formatSectionHeader(
  scenario: TelegramScenario,
  title: string,
  icon?: string,
): string {
  const { dot, accent } = TELEGRAM_PALETTE[scenario];
  const lead = icon ?? accent;
  return `${dot} ${lead} <b>${title}</b>`;
}

/** Top-of-message scenario banner. */
export function formatScenarioBanner(
  scenario: TelegramScenario,
  headlineHtml: string,
): string {
  const { dot, accent } = TELEGRAM_PALETTE[scenario];
  return `${dot} ${accent} <b>${headlineHtml}</b>`;
}

/** Prefix a line with colour dot + icon — keeps body emojis intact. */
export function tintLine(scenario: TelegramScenario, line: string): string {
  const { dot, accent } = TELEGRAM_PALETTE[scenario];
  return `${dot} ${accent} ${line}`;
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