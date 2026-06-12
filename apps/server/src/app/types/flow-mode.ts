export type FlowMode = 'blend' | 'pa-only';

export function normalizeFlowMode(value: unknown): FlowMode {
  if (value === 'pa-only' || value === 'pa' || value === 'paonly') {
    return 'pa-only';
  }
  return 'blend';
}

export function isPaOnlyFlow(mode: FlowMode): boolean {
  return mode === 'pa-only';
}

export function flowModeLabel(mode: FlowMode): string {
  return mode === 'pa-only' ? 'PA only' : 'Blend (PA + options)';
}

export function parseFlowModeQuery(
  flowModeQuery?: string,
  optionFlowOffQuery?: string,
): FlowMode {
  if (optionFlowOffQuery === 'true' || optionFlowOffQuery === '1') {
    return 'pa-only';
  }
  if (!flowModeQuery) return 'blend';
  const normalized = flowModeQuery.trim().toLowerCase();
  if (
    normalized === 'pa-only' ||
    normalized === 'pa' ||
    normalized === 'paflow' ||
    normalized === 'off'
  ) {
    return 'pa-only';
  }
  if (normalized === 'blend' || normalized === 'on' || normalized === 'both') {
    return 'blend';
  }
  return 'blend';
}