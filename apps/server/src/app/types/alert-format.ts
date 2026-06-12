export const ALERT_FORMAT_MODES = ['full', 'compact'] as const;
export type AlertFormatMode = (typeof ALERT_FORMAT_MODES)[number];

export const DEFAULT_ALERT_FORMAT: AlertFormatMode = 'full';

export function normalizeAlertFormatMode(value: unknown): AlertFormatMode {
  if (value === 'compact') return 'compact';
  return 'full';
}

export function alertFormatLabel(mode: AlertFormatMode): string {
  return mode === 'compact' ? 'Compact' : 'Full';
}