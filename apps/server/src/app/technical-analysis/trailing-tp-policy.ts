import { LIVE_TRADE_RR_ORDER, TRAIL_GIVEBACK_R } from '../constants/trade-rr';
import {
  RrLabel,
  TradeAction,
  TradeSetup,
  TradeTakeProfitLevel,
} from '../types/technical-analysis';

export type TpTier = 0 | 1 | 2 | 3;

export function favorableR(
  action: TradeAction,
  price: number,
  entry: number,
  risk: number,
): number {
  if (risk <= 0) return 0;
  if (action === 'CE-BUY') return Math.max(0, (price - entry) / risk);
  if (action === 'PE-BUY') return Math.max(0, (entry - price) / risk);
  return 0;
}

/**
 * Locked reversal floor in R-multiples.
 * Tier locks at 1.5 / 2.5 / 4; beyond 4R the floor ratchets (peak − giveback).
 */
export function resolveTrailFloorR(peakR: number): number | null {
  if (peakR < 1.5) return null;
  if (peakR < 2.5) return 1.5;
  if (peakR < 4) return 2.5;
  return Math.max(4, +(peakR - TRAIL_GIVEBACK_R).toFixed(3));
}

export function floorPriceFromR(
  action: TradeAction,
  entry: number,
  risk: number,
  floorR: number,
): number {
  if (action === 'CE-BUY') return +(entry + risk * floorR).toFixed(2);
  if (action === 'PE-BUY') return +(entry - risk * floorR).toFixed(2);
  return entry;
}

export function formatTrailFloorHitLevel(floorR: number): RrLabel | 'TRAIL_FLOOR' {
  if (Math.abs(floorR - 1.5) < 0.08) return '1:1.5';
  if (Math.abs(floorR - 2.5) < 0.08) return '1:2.5';
  if (Math.abs(floorR - 4) < 0.08) return '1:4';
  return 'TRAIL_FLOOR';
}

export function rrLabelToTier(rr: RrLabel | null | undefined): TpTier {
  if (rr === '1:4') return 3;
  if (rr === '1:2.5' || rr === '1:3') return 2;
  if (rr === '1:1.5' || rr === '1:2' || rr === '1:1') return 1;
  return 0;
}

export function maxRrLabel(a: RrLabel | null, b: RrLabel | null): RrLabel | null {
  if (!a) return b;
  if (!b) return a;
  return LIVE_TRADE_RR_ORDER.indexOf(a) >= LIVE_TRADE_RR_ORDER.indexOf(b) ? a : b;
}

export function highestTpHit(
  direction: TradeAction,
  spot: number,
  takeProfits: TradeTakeProfitLevel[],
): TradeTakeProfitLevel | null {
  if (direction === 'CE-BUY') {
    for (let i = takeProfits.length - 1; i >= 0; i -= 1) {
      if (spot >= takeProfits[i].price) return takeProfits[i];
    }
    return null;
  }
  if (direction === 'PE-BUY') {
    for (let i = takeProfits.length - 1; i >= 0; i -= 1) {
      if (spot <= takeProfits[i].price) return takeProfits[i];
    }
    return null;
  }
  return null;
}

export function nextTpLevel(
  direction: TradeAction,
  spot: number,
  takeProfits: TradeTakeProfitLevel[],
): TradeTakeProfitLevel | null {
  if (direction === 'CE-BUY') {
    return takeProfits.find((tp) => spot < tp.price) ?? null;
  }
  if (direction === 'PE-BUY') {
    return takeProfits.find((tp) => spot > tp.price) ?? null;
  }
  return null;
}

export function isReversalFloorBreached(
  direction: TradeAction,
  spot: number,
  floorPrice: number,
): boolean {
  if (direction === 'CE-BUY') return spot < floorPrice;
  if (direction === 'PE-BUY') return spot > floorPrice;
  return false;
}

export interface TrailingTpState {
  peakRr: RrLabel | null;
  peakR: number;
  peakTier: TpTier;
  lockedFloorR: number | null;
  lockedFloorPrice: number | null;
  floorBreached: boolean;
  extensionPastMaxTp: boolean;
}

export function evaluateTrailingTpState(
  direction: TradeAction,
  spot: number,
  setup: TradeSetup,
  previousPeakRr: RrLabel | null,
  previousPeakR = 0,
): TrailingTpState {
  const currentR = favorableR(direction, spot, setup.entry, setup.risk);
  const peakR = Math.max(previousPeakR, currentR);
  const spotHit = highestTpHit(direction, spot, setup.takeProfits);
  const peakRr = maxRrLabel(previousPeakRr, spotHit?.rr ?? null);
  const peakTier = rrLabelToTier(peakRr);
  const lockedFloorR = resolveTrailFloorR(peakR);
  const lockedFloorPrice =
    lockedFloorR != null
      ? floorPriceFromR(direction, setup.entry, setup.risk, lockedFloorR)
      : null;
  const floorBreached =
    lockedFloorPrice != null
      ? isReversalFloorBreached(direction, spot, lockedFloorPrice)
      : false;
  const maxTp = setup.takeProfits[setup.takeProfits.length - 1];
  const extensionPastMaxTp =
    peakR >= 4 &&
    maxTp != null &&
    (direction === 'CE-BUY' ? spot > maxTp.price : spot < maxTp.price);

  return {
    peakRr,
    peakR,
    peakTier,
    lockedFloorR,
    lockedFloorPrice,
    floorBreached,
    extensionPastMaxTp,
  };
}

export type TrailingHoldAdvice = 'hold' | 'partial' | 'trail' | 'exit';

export interface TrailingTpHoldGuidance {
  holdAdvice: TrailingHoldAdvice;
  holdHeadline: string;
  holdReasons: string[];
  alertKind: 'REACHED' | 'HOLD_REVIEW' | 'APPROACHING' | 'SIGNAL_CONFLICT';
}

function floorRLabel(floorR: number | null): string {
  if (floorR == null) return '—';
  if (floorR >= 4 && Math.abs(floorR - 4) > 0.08) {
    return `${floorR.toFixed(1)}R`;
  }
  if (Math.abs(floorR - 1.5) < 0.08) return '1:1.5';
  if (Math.abs(floorR - 2.5) < 0.08) return '1:2.5';
  if (Math.abs(floorR - 4) < 0.08) return '1:4';
  return `${floorR.toFixed(1)}R`;
}

export function buildTrailingTpHoldGuidance(params: {
  conviction: number;
  enterThreshold: number;
  strongThreshold: number;
  momentumDecayPercent: number | null;
  trailing: TrailingTpState;
  nextTpRr: RrLabel | null;
  currentR: number;
  approaching: boolean;
  oppositeFlipConfirmed: boolean;
  peakLockedForFlip: boolean;
}): TrailingTpHoldGuidance {
  const reasons: string[] = [];
  const floorLabel = floorRLabel(params.trailing.lockedFloorR);

  if (params.oppositeFlipConfirmed && params.peakLockedForFlip) {
    return {
      holdAdvice: 'exit',
      holdHeadline:
        'Opposite signal confirmed (2 polls) — exit at market and protect open gains.',
      holdReasons: [
        'Engine flipped direction with conviction on two consecutive polls.',
        'Matches live engaged hard-exit and benchmark flip-exit rules.',
      ],
      alertKind: 'SIGNAL_CONFLICT',
    };
  }

  if (params.trailing.floorBreached && params.trailing.lockedFloorR != null) {
    return {
      holdAdvice: 'exit',
      holdHeadline: `Reversal through ${floorLabel} trail floor — book per ratchet plan.`,
      holdReasons: [
        `Peak was ${params.trailing.peakR.toFixed(1)}R; floor locked at ${floorLabel}.`,
        'Dynamic ratchet — no hard drop to 1:2.5 after 1:4.',
      ],
      alertKind: 'REACHED',
    };
  }

  if (params.momentumDecayPercent != null && params.momentumDecayPercent >= 25) {
    reasons.push(
      `Momentum decay is elevated (${params.momentumDecayPercent}%) — edge is fading.`,
    );
  }

  if (params.trailing.peakR >= 4 || params.trailing.extensionPastMaxTp) {
    return {
      holdAdvice: 'trail',
      holdHeadline:
        params.trailing.peakR > 4.1
          ? `Extended to ${params.trailing.peakR.toFixed(1)}R — trail floor ${floorLabel} (peak − 1R).`
          : '1:4 locked — hold for extension; floor ratchets at peak − 1R.',
      holdReasons: [
        'No hard exit at 1:4 — runners stay live until ratchet floor or 2-poll flip.',
        `Current ${params.currentR.toFixed(2)}R · trail floor ${floorLabel}.`,
        ...reasons,
      ],
      alertKind: 'HOLD_REVIEW',
    };
  }

  if (params.trailing.peakRr === '1:2.5' || params.trailing.peakR >= 2.5) {
    const canHold =
      params.conviction >= params.strongThreshold &&
      (params.momentumDecayPercent ?? 0) < 20;
    return {
      holdAdvice: canHold ? 'trail' : 'partial',
      holdHeadline: canHold
        ? '1:2.5 locked — trail toward 1:4; floor protects at 1:2.5 on reversal.'
        : '1:2.5 locked — book partials; trail remainder with 1:2.5 floor.',
      holdReasons: canHold
        ? [
            `Conviction still strong (${params.conviction}% ≥ ${params.strongThreshold}).`,
            'Past 1:4 the floor moves up with peak — never snaps back to 1:2.5.',
            ...reasons,
          ]
        : [
            'Take meaningful profit at 1:2.5; only trail reduced size toward 1:4.',
            ...reasons,
          ],
      alertKind: 'HOLD_REVIEW',
    };
  }

  if (params.trailing.peakRr === '1:1.5' || params.trailing.peakR >= 1.5) {
    const canHold = params.conviction >= params.enterThreshold;
    return {
      holdAdvice: canHold ? 'partial' : 'exit',
      holdHeadline: canHold
        ? '1:1.5 locked — book partial, trail rest toward 1:2.5 / 1:4.'
        : '1:1.5 locked but conviction weakened — prefer booking most of the trade.',
      holdReasons: canHold
        ? [
            'First floor locked. System still aligned — 50% off + breakeven stop is common.',
            `Next engine target is ${params.nextTpRr ?? '1:2.5'}.`,
            ...reasons,
          ]
        : [
            'First floor locked but follow-through quality is poor — do not assume 1:2.5.',
            ...reasons,
          ],
      alertKind: 'HOLD_REVIEW',
    };
  }

  if (params.approaching && params.nextTpRr) {
    const canHold = params.conviction >= params.strongThreshold - 10;
    return {
      holdAdvice: canHold ? 'hold' : 'partial',
      holdHeadline: canHold
        ? `Approaching ${params.nextTpRr} — prepare to scale out or trail if wicks reject.`
        : `Approaching ${params.nextTpRr} — lean toward booking into the level.`,
      holdReasons: canHold
        ? [
            `Spot is within reach of engine ${params.nextTpRr} (${params.currentR.toFixed(2)}R now).`,
            'If level rejects, tighten stop; if it accepts with volume, trail for next R.',
            ...reasons,
          ]
        : [
            `Near ${params.nextTpRr} but conviction is only ${params.conviction}%.`,
            'Consider taking profit into the level instead of hoping for extension.',
            ...reasons,
          ],
      alertKind: 'APPROACHING',
    };
  }

  return {
    holdAdvice: 'hold',
    holdHeadline: 'Position in progress — no TP trigger yet.',
    holdReasons: reasons,
    alertKind: 'HOLD_REVIEW',
  };
}

export interface DrawdownStats {
  maxDrawdownInr: number;
  maxDrawdownPercent: number;
  maxDrawdownR: number;
}

export function computeDrawdownFromSeries(
  values: number[],
): { maxDrawdown: number; maxDrawdownPercent: number } {
  if (!values.length) return { maxDrawdown: 0, maxDrawdownPercent: 0 };
  let peak = values[0];
  let maxDd = 0;
  let maxDdPct = 0;
  for (const v of values) {
    peak = Math.max(peak, v);
    const dd = peak - v;
    const ddPct = peak > 0 ? (dd / peak) * 100 : 0;
    if (dd > maxDd) maxDd = dd;
    if (ddPct > maxDdPct) maxDdPct = ddPct;
  }
  return {
    maxDrawdown: +maxDd.toFixed(2),
    maxDrawdownPercent: +maxDdPct.toFixed(2),
  };
}