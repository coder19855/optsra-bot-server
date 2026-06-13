import { VetoMode, vetoModeLabel } from '../types/veto-mode';
import { joinTelegramLines, joinTelegramSections } from './message-layout';

export function formatVetoStatusMessage(vetoMode: VetoMode): string {
  const mode = vetoModeLabel(vetoMode);
  const detail =
    vetoMode === 'off'
      ? 'All PA chart vetoes and option-flow blocks are bypassed for live reads, alerts, and deck.'
      : vetoMode === 'relaxed'
        ? 'Hard decay vetoes still apply; soft decay, min-confidence, and option-conflict blocks are eased.'
        : 'Full safety gates: entry vetoes, decay, structure blocks, and option conflict.';

  return joinTelegramSections(
    '⛔ <b>Chart veto mode</b>',
    joinTelegramLines(`Current: <b>${mode}</b>`, detail, ''),
    joinTelegramLines(
      '<code>/veto strict</code> — full vetoes (default)',
      '<code>/veto relaxed</code> — hard decay only + softer option gates',
      '<code>/veto off</code> — what-if / research mode',
      '<code>/veto on</code> — alias for strict',
      '<code>/veto status</code> — show current mode',
      '',
      '<i>Deck replay uses the same mode; scrub shows what each setting would display.</i>',
      '<i>⚠️ Off/relaxed are for research — size and risk rules still apply.</i>',
    ),
  );
}

export function parseVetoCommandArgs(text: string): {
  action: 'status' | VetoMode;
} {
  const parts = text.trim().toLowerCase().split(/\s+/);
  const arg = parts[1];

  if (!arg || arg === 'status') return { action: 'status' };
  if (arg === 'off' || arg === 'disable' || arg === 'false') {
    return { action: 'off' };
  }
  if (arg === 'on' || arg === 'enable' || arg === 'true' || arg === 'strict') {
    return { action: 'strict' };
  }
  if (arg === 'relaxed' || arg === 'light' || arg === 'easy') {
    return { action: 'relaxed' };
  }

  return { action: 'status' };
}