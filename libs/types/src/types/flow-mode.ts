export type FlowMode = 'blend' | 'pa-only' | 'option-only';

export function normalizeFlowMode(value: unknown): FlowMode {
  if (value === 'pa-only' || value === 'pa' || value === 'paonly') {
    return 'pa-only';
  }
  if (
    value === 'option-only' ||
    value === 'option' ||
    value === 'options' ||
    value === 'optionflow'
  ) {
    return 'option-only';
  }
  return 'blend';
}

export function isPaOnlyFlow(mode: FlowMode): boolean {
  return mode === 'pa-only';
}

export function isOptionOnlyFlow(mode: FlowMode): boolean {
  return mode === 'option-only';
}

export function isSingleSourceFlow(mode: FlowMode): boolean {
  return mode === 'pa-only' || mode === 'option-only';
}

export function flowModeLabel(mode: FlowMode): string {
  if (mode === 'pa-only') return 'PA only';
  if (mode === 'option-only') return 'Option only';
  return 'Blend (PA + options)';
}

export function parseFlowModeQuery(
  flowModeQuery?: string,
  optionFlowOffQuery?: string,
): FlowMode {
  if (optionFlowOffQuery === 'true' || optionFlowOffQuery === '1') {
    return 'pa-only';
  }
  if (!flowModeQuery) return 'blend';
  return normalizeFlowMode(flowModeQuery.trim().toLowerCase());
}