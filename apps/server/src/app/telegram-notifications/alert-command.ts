import {
  AlertFormatMode,
  alertFormatLabel,
  normalizeAlertFormatMode,
} from '../types/alert-format';
import { joinTelegramLines, joinTelegramSections } from './message-layout';

export function parseAlertCommandArgs(text: string): {
  action: 'status' | AlertFormatMode;
} {
  const parts = text.trim().toLowerCase().split(/\s+/);
  const arg = parts[1];

  if (!arg || arg === 'status') return { action: 'status' };
  if (arg === 'full' || arg === 'verbose' || arg === 'long') {
    return { action: 'full' };
  }
  if (arg === 'compact' || arg === 'short' || arg === 'minimal') {
    return { action: 'compact' };
  }

  return { action: 'status' };
}

export function formatAlertStatusMessage(alertFormat: AlertFormatMode): string {
  const label = alertFormatLabel(alertFormat);
  const detail =
    alertFormat === 'compact'
      ? 'Signal pings stay short — flip, strike, veto one-liner. PA, flow, Greeks, playbook live in Deck.'
      : 'Signal pings include PA, flow, structure, Greeks, playbook, and wallet sizing.';

  return joinTelegramSections(
    '🔔 <b>Alert format</b>',
    joinTelegramLines(`Current: <b>${label}</b>`, detail, ''),
    joinTelegramLines(
      '<code>/alert full</code> — full breakdown in chat',
      '<code>/alert compact</code> — trim deck-duplicated detail',
      '<code>/alert status</code> — show current mode',
      '',
      '<i>Compact alerts still include headline, strike pick, and was → now.</i>',
      '<i>Deck button on each alert for the full picture.</i>',
    ),
  );
}

export function alertFormatFromArg(
  value: string | undefined,
): AlertFormatMode | null {
  const parsed = parseAlertCommandArgs(`/alert ${value ?? ''}`);
  return parsed.action === 'status' ? null : normalizeAlertFormatMode(parsed.action);
}