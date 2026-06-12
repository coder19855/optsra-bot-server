import { FlowMode, flowModeLabel } from '../types/flow-mode';
import { joinTelegramLines, joinTelegramSections } from './message-layout';

export function formatFlowStatusMessage(flowMode: FlowMode): string {
  const mode = flowModeLabel(flowMode);
  const detail =
    flowMode === 'pa-only'
      ? 'Option flow is ignored for conviction, conflict gates, and entry %. Price action alone drives the blend (direction still from PA signal).'
      : 'Default blend: style-weighted price action + option flow conviction.';

  return joinTelegramSections(
    '📊 <b>Option flow scoring</b>',
    joinTelegramLines(`Current: <b>${mode}</b>`, detail, ''),
    joinTelegramLines(
      '<code>/flow blend</code> — PA + options (default)',
      '<code>/flow pa</code> — PA only, ignore option score',
      '<code>/flow on</code> — alias for blend',
      '<code>/flow off</code> — alias for PA only',
      '<code>/flow status</code> — show current mode',
      '',
      '<i>Applies to /now, alerts, and deck live reads.</i>',
      '<i>Option components still show on the Comp tab for reference.</i>',
    ),
  );
}

export function parseFlowCommandArgs(text: string): {
  action: 'status' | FlowMode;
} {
  const parts = text.trim().toLowerCase().split(/\s+/);
  const arg = parts[1];

  if (!arg || arg === 'status') return { action: 'status' };
  if (
    arg === 'pa' ||
    arg === 'pa-only' ||
    arg === 'paflow' ||
    arg === 'off' ||
    arg === 'disable'
  ) {
    return { action: 'pa-only' };
  }
  if (
    arg === 'blend' ||
    arg === 'on' ||
    arg === 'enable' ||
    arg === 'both' ||
    arg === 'options'
  ) {
    return { action: 'blend' };
  }

  return { action: 'status' };
}