import { isSoftDecayVetoReason, isVetoOff, VetoMode } from '../types/veto-mode';

export type DeckVetoBreakupState = 'block' | 'warn' | 'ok' | 'skipped';

export interface DeckVetoBreakupItem {
  id: string;
  label: string;
  state: DeckVetoBreakupState;
  detail: string;
  /** 0–100 severity meter (optional visual). */
  meter?: number;
}

export interface DeckVetoBreakupInput {
  vetoMode: VetoMode;
  action: string;
  conviction: number;
  priceConviction: number;
  priceConvictionBeforeDecay?: number;
  optionConviction: number;
  enterThreshold: number;
  conflictLevel?: string;
  alignment?: number;
  paSignal: {
    action: string;
    confidence: number;
    structuralAction?: string;
    vetoReason?: string;
    confidenceBeforeDecay?: number;
  };
  momentumDecay?: {
    decayPercent: number;
    reasons: string[];
  };
  vetoedByDecay?: boolean;
  minConfidenceAfterDecay?: number;
}

function pushItem(
  items: DeckVetoBreakupItem[],
  item: DeckVetoBreakupItem,
): void {
  items.push(item);
}

function vetoStateForReason(
  reason: string | undefined,
  vetoMode: VetoMode,
): DeckVetoBreakupState {
  if (!reason) return 'ok';
  if (isVetoOff(vetoMode)) return 'skipped';
  if (vetoMode === 'relaxed' && isSoftDecayVetoReason(reason)) return 'skipped';
  if (/hard decay|below minimum|blocked:/i.test(reason)) return 'block';
  return 'warn';
}

export function buildDeckVetoBreakup(input: DeckVetoBreakupInput): DeckVetoBreakupItem[] {
  const items: DeckVetoBreakupItem[] = [];
  const vetoOff = isVetoOff(input.vetoMode);
  const relaxed = input.vetoMode === 'relaxed';

  pushItem(items, {
    id: 'mode',
    label: 'Veto mode',
    state: vetoOff ? 'skipped' : relaxed ? 'warn' : 'ok',
    detail: vetoOff
      ? 'All chart vetoes bypassed (research)'
      : relaxed
        ? 'Relaxed — hard decay only; soft gates eased'
        : 'Strict — full chart + decay gates',
  });

  const vetoReason = input.paSignal.vetoReason;
  const chartState = vetoStateForReason(vetoReason, input.vetoMode);
  pushItem(items, {
    id: 'chart',
    label: 'Chart entry gate',
    state: vetoReason ? chartState : 'ok',
    detail: vetoReason
      ? vetoReason
      : input.paSignal.action === 'NO-TRADE'
        ? 'No directional chart entry'
        : `Chart allows ${input.paSignal.action}`,
  });

  const structural = input.paSignal.structuralAction;
  if (
    structural &&
    structural !== 'NO-TRADE' &&
    input.paSignal.action === 'NO-TRADE'
  ) {
    pushItem(items, {
      id: 'structural',
      label: 'Structural direction',
      state: vetoOff ? 'skipped' : chartState === 'skipped' ? 'warn' : 'block',
      detail: `Structure suggests ${structural} but chart read is NO-TRADE`,
    });
  }

  const decayPct = Math.round((input.momentumDecay?.decayPercent ?? 0) * 100);
  if (decayPct > 0 || input.vetoedByDecay) {
    const hardBlock =
      input.vetoedByDecay ||
      (input.momentumDecay?.decayPercent ?? 0) >= 0.35;
    let decayState: DeckVetoBreakupState = 'warn';
    if (vetoOff) decayState = 'skipped';
    else if (hardBlock) decayState = 'block';
    else if (relaxed) decayState = 'skipped';

    const before =
      input.priceConvictionBeforeDecay ??
      input.paSignal.confidenceBeforeDecay ??
      input.priceConviction;
    pushItem(items, {
      id: 'decay',
      label: 'Momentum decay',
      state: decayState,
      meter: Math.min(100, decayPct),
      detail: `PA ${input.priceConviction}% after ${decayPct}% decay (was ${before}%)`,
    });

    for (const [idx, reason] of (input.momentumDecay?.reasons ?? []).entries()) {
      if (!reason.trim()) continue;
      pushItem(items, {
        id: `decay-reason-${idx}`,
        label: 'Decay factor',
        state: decayState,
        detail: reason,
      });
    }
  } else {
    pushItem(items, {
      id: 'decay',
      label: 'Momentum decay',
      state: 'ok',
      detail: 'No momentum decay applied',
    });
  }

  if (
    input.minConfidenceAfterDecay != null &&
    input.paSignal.confidence === 0 &&
    decayPct > 0
  ) {
    pushItem(items, {
      id: 'min-confidence',
      label: 'Min confidence floor',
      state: vetoOff || relaxed ? 'skipped' : 'block',
      detail: `PA confidence ${input.paSignal.confidence}% below floor ${input.minConfidenceAfterDecay}%`,
      meter: 100,
    });
  }

  const conflict = String(input.conflictLevel ?? 'NONE').toUpperCase();
  if (conflict === 'HIGH') {
    pushItem(items, {
      id: 'conflict',
      label: 'Option vs PA conflict',
      state: vetoOff || relaxed ? 'warn' : 'block',
      meter: 85,
      detail: 'Option flow strongly disagrees with price action',
    });
  } else if (conflict === 'MEDIUM') {
    pushItem(items, {
      id: 'conflict',
      label: 'Option vs PA conflict',
      state: 'warn',
      meter: 55,
      detail: 'Mild disagreement between option flow and price action',
    });
  } else {
    pushItem(items, {
      id: 'conflict',
      label: 'Option vs PA conflict',
      state: 'ok',
      detail: 'No major option / PA conflict',
    });
  }

  const aligned = input.alignment ?? 0;
  pushItem(items, {
    id: 'alignment',
    label: 'TF alignment',
    state: aligned >= 2 ? 'ok' : aligned === 1 ? 'warn' : 'block',
    meter: Math.round((aligned / 3) * 100),
    detail: `${aligned}/3 timeframes aligned with primary`,
  });

  pushItem(items, {
    id: 'enter-threshold',
    label: 'Enter threshold',
    state:
      input.conviction >= input.enterThreshold
        ? 'ok'
        : input.conviction >= input.enterThreshold * 0.7
          ? 'warn'
          : 'block',
    meter: Math.min(
      100,
      Math.round((input.conviction / Math.max(1, input.enterThreshold)) * 100),
    ),
    detail: `Combined ${input.conviction}% vs ${input.enterThreshold}% bar (option ${input.optionConviction}% · PA ${input.priceConviction}%)`,
  });

  if (input.action === 'NO-TRADE' && !vetoReason && decayPct === 0) {
    pushItem(items, {
      id: 'outcome',
      label: 'Decision',
      state: 'warn',
      detail: 'Low confluence — engine stays flat despite partial option/PA reads',
    });
  }

  const stateOrder: Record<DeckVetoBreakupState, number> = {
    block: 0,
    warn: 1,
    skipped: 2,
    ok: 3,
  };
  return items.sort(
    (a, b) => (stateOrder[a.state] ?? 9) - (stateOrder[b.state] ?? 9),
  );
}

export function buildReplayVetoBreakup(input: {
  vetoMode: VetoMode;
  action: string;
  conviction: number;
  vetoed: boolean;
  vetoReason?: string;
  structuralAction?: string;
}): DeckVetoBreakupItem[] {
  return buildDeckVetoBreakup({
    vetoMode: input.vetoMode,
    action: input.action,
    conviction: input.conviction,
    priceConviction: input.conviction,
    optionConviction: 0,
    enterThreshold: 60,
    paSignal: {
      action: input.action,
      confidence: input.conviction,
      structuralAction: input.structuralAction,
      vetoReason: input.vetoReason,
    },
    alignment: input.vetoed ? 0 : 2,
  });
}