import { AiBetaPreferenceState } from './ai-beta-preference';
import { joinTelegramLines, joinTelegramSections } from './message-layout';

export function parseBetaCommandArgs(text: string): {
  action: 'status' | 'toggle' | 'provider' | 'shadow';
  value?: string;
} {
  const parts = text.trim().toLowerCase().split(/\s+/);
  const arg = parts[1];
  const value = parts[2];

  if (!arg || arg === 'status') return { action: 'status' };
  if (arg === 'ai') return { action: 'toggle', value };
  if (arg === 'provider' || arg === 'model') return { action: 'provider', value };
  if (arg === 'shadow') return { action: 'shadow', value };

  return { action: 'status' };
}

export function formatBetaStatusMessage(state: AiBetaPreferenceState): string {
  const status = state.enabled ? '🟢 Enabled' : '🔴 Disabled';
  const shadowStatus = state.shadowMode ? '👥 Shadow (Opinion Only)' : '⚔️ Active (Influences Score)';

  return joinTelegramSections(
    '🧪 <b>Beta Features</b>',
    joinTelegramLines(
      `AI Agent: <b>${status}</b>`,
      `Provider: <b>${state.provider}</b>`,
      `Mode: <b>${shadowStatus}</b>`,
      '',
    ),
    joinTelegramLines(
      '<code>/beta ai on|off</code> — toggle AI agent',
      '<code>/beta provider GEMINI|GROQ</code> — switch AI model',
      '<code>/beta shadow on|off</code> — opinion vs influencing score',
      '<code>/beta status</code> — show current beta config',
      '',
      '<i>Shadow mode adds "AI Beta Note" to alerts without changing math.</i>',
    ),
  );
}
