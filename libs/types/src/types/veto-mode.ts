export type VetoMode = 'strict' | 'relaxed' | 'off';

export function normalizeVetoMode(
  value: unknown,
  fallback: VetoMode = 'strict',
): VetoMode {
  if (value === 'strict' || value === 'relaxed' || value === 'off') {
    return value;
  }
  return fallback;
}

export function parseVetoOffQuery(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

export function parseVetoModeQuery(
  vetoMode?: string,
  vetoOff?: string,
): VetoMode {
  if (vetoMode) {
    const normalized = vetoMode.trim().toLowerCase();
    if (
      normalized === 'strict' ||
      normalized === 'relaxed' ||
      normalized === 'off'
    ) {
      return normalized;
    }
  }
  if (parseVetoOffQuery(vetoOff)) return 'off';
  return 'strict';
}

export function isVetoOff(mode: VetoMode): boolean {
  return mode === 'off';
}

/** Decay / post-entry vetoes that relaxed mode still skips. */
export function isSoftDecayVetoReason(reason?: string): boolean {
  if (!reason) return false;
  return (
    /decay/i.test(reason) ||
    /confidence after decay/i.test(reason) ||
    /opposing 15m structure/i.test(reason)
  );
}

export function vetoModeLabel(mode: VetoMode): string {
  if (mode === 'off') return 'OFF';
  if (mode === 'relaxed') return 'RELAXED';
  return 'STRICT';
}