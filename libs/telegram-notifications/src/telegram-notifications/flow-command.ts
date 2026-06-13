import { FlowMode, flowModeLabel } from '../types/flow-mode';
import { joinTelegramLines, joinTelegramSections } from './message-layout';

export function formatFlowStatusMessage(flowMode: FlowMode): string {
  const mode = flowModeLabel(flowMode);
  const detail =
    flowMode === 'pa-only'
      ? 'Price action alone drives conviction and direction. Option flow is ignored.'
      : flowMode === 'option-only'
        ? 'Option flow alone drives conviction and direction. Price action is ignored for the blend.'
        : 'Style-weighted blend of price action + option flow (default).';

  return joinTelegramSections(
    '📊 <b>Flow scoring mode</b>',
    joinTelegramLines(`Current: <b>${mode}</b>`, detail, ''),
    joinTelegramLines(
      '<code>/flow pa</code> — price action only',
      '<code>/flow option</code> — option flow only',
      '<code>/flow blend</code> — PA + options (default)',
      '<code>/flow on</code> — alias for blend',
      '<code>/flow status</code> — show current mode',
      '',
      '<i>Applies to /now, alerts, and deck live reads.</i>',
      '<i>Comp tab still shows both breakdowns for reference.</i>',
    ),
  );
}

export function parseFlowCommandArgs(text: string): {
  action: 'status' | FlowMode;
} {
  const parts = text.trim().toLowerCase().split(/\s+/);
  const arg = parts[1];

  if (!arg || arg === 'status') return { action: 'status' };
  if (arg === 'pa' || arg === 'pa-only' || arg === 'paflow' || arg === 'price') {
    return { action: 'pa-only' };
  }
  if (
    arg === 'option' ||
    arg === 'options' ||
    arg === 'option-only' ||
    arg === 'optionflow'
  ) {
    return { action: 'option-only' };
  }
  if (arg === 'blend' || arg === 'on' || arg === 'both' || arg === 'enable') {
    return { action: 'blend' };
  }

  return { action: 'status' };
}