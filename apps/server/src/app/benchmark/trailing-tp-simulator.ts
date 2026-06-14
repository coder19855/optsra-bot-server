import { FyersAPI } from 'fyers-api-v3';
import {
  RrLabel,
  TradeAction,
  TradeOutcome,
  TradeSetup,
  TradeTakeProfitLevel,
} from '../types/technical-analysis';
import { toIso } from '../technical-analysis/timeline-utils';
import {
  favorableR,
  floorPriceFromR,
  formatTrailFloorHitLevel,
  resolveTrailFloorR,
} from '../technical-analysis/trailing-tp-policy';

export type { FlipExitSignal } from '../technical-analysis/flip-exit-policy';
import type { FlipExitSignal } from '../technical-analysis/flip-exit-policy';

export interface TrailingFloorSimOptions {
  flipExits?: FlipExitSignal[];
  enableFlipExit?: boolean;
}

type TpTier = 0 | 1 | 2 | 3;

function signedPnl(
  action: TradeAction,
  entry: number,
  exitPrice: number,
): number {
  if (action === 'CE-BUY') return +(exitPrice - entry).toFixed(2);
  if (action === 'PE-BUY') return +(entry - exitPrice).toFixed(2);
  return 0;
}

function sortedTakeProfits(setup: TradeSetup): TradeTakeProfitLevel[] {
  return [...setup.takeProfits].sort((a, b) => a.multiplier - b.multiplier);
}

function maxTierTouchedOnCandle(
  action: TradeAction,
  tiers: TradeTakeProfitLevel[],
  high: number,
  low: number,
): TpTier {
  let max: TpTier = 0;
  tiers.forEach((tp, index) => {
    const hit =
      action === 'CE-BUY' ? high >= tp.price : low <= tp.price;
    if (hit) {
      const tier = (index + 1) as TpTier;
      if (tier > max) max = tier;
    }
  });
  return max;
}

function tierLevel(tiers: TradeTakeProfitLevel[], tier: 1 | 2 | 3) {
  return tiers[tier - 1] ?? null;
}

function peakRFromCandle(
  action: TradeAction,
  entry: number,
  risk: number,
  high: number,
  low: number,
): number {
  const favorable =
    action === 'CE-BUY' ? favorableR(action, high, entry, risk) : favorableR(action, low, entry, risk);
  return favorable;
}

/**
 * Trail with tier locks (1:1.5 → 1:2.5 → 1:4) then dynamic ratchet (peakR − 1R).
 * No auto-exit at 1:4; hold until ratchet floor, flip, SL, or session end.
 */
function ratchetFloorExit(
  action: TradeAction,
  setup: TradeSetup,
  peakR: number,
  close: number,
  tsMs: number,
  barsHeld: number,
  withScope: (outcome: TradeOutcome) => TradeOutcome,
): TradeOutcome | null {
  const floorR = resolveTrailFloorR(peakR);
  if (floorR == null) return null;

  const floorPrice = floorPriceFromR(
    action,
    setup.entry,
    setup.risk,
    floorR,
  );
  const reversed =
    action === 'CE-BUY' ? close < floorPrice : close > floorPrice;
  if (!reversed) return null;

  const hitLevel = formatTrailFloorHitLevel(floorR);
  return withScope({
    status: 'TAKE_PROFIT',
    pnl: signedPnl(action, setup.entry, floorPrice),
    pnlR: +floorR.toFixed(3),
    exitPrice: floorPrice,
    exitAt: tsMs,
    exitAtISO: toIso(tsMs),
    hitLevel,
    barsHeld,
  });
}

function highestTouchedLabel(
  tiers: TradeTakeProfitLevel[],
  peakTier: TpTier,
): RrLabel | 'SESSION_END' | 'OPEN' {
  if (peakTier >= 3) return tierLevel(tiers, 3)!.rr;
  if (peakTier >= 2) return tierLevel(tiers, 2)!.rr;
  if (peakTier >= 1) return tierLevel(tiers, 1)!.rr;
  return 'OPEN';
}

export function simulateTradeOutcomeWithTrailingFloor(
  action: TradeAction,
  setup: TradeSetup | undefined,
  forwardCandles: FyersAPI.Candle[],
  simulationScope: 'session' | 'window' = 'session',
  options?: TrailingFloorSimOptions,
): TradeOutcome {
  if (action === 'NO-TRADE' || !setup) {
    return {
      status: 'NO-TRADE',
      pnl: 0,
      pnlR: 0,
      exitPrice: 0,
      barsHeld: 0,
      hitLevel: 'OPEN',
      simulationScope,
    };
  }

  const { entry, stopLoss, risk } = setup;
  const tiers = sortedTakeProfits(setup);

  if (forwardCandles.length === 0) {
    return {
      status: simulationScope === 'session' ? 'SESSION_END' : 'OPEN',
      pnl: 0,
      pnlR: 0,
      exitPrice: entry,
      hitLevel: simulationScope === 'session' ? 'SESSION_END' : 'OPEN',
      barsHeld: 0,
      simulationScope,
    };
  }

  const withScope = (outcome: TradeOutcome): TradeOutcome => ({
    ...outcome,
    simulationScope,
  });

  let peakTier: TpTier = 0;
  let peakR = 0;
  const flipExits = options?.flipExits ?? [];
  const enableFlipExit = options?.enableFlipExit !== false;
  let flipIdx = 0;

  for (let i = 0; i < forwardCandles.length; i += 1) {
    const candle = forwardCandles[i];
    const [, , high, low, close] = candle;
    const tsMs = candle[0] * 1000;
    const lockedPeakR = peakR;

    while (flipIdx < flipExits.length && flipExits[flipIdx].tsMs <= tsMs) {
      const flip = flipExits[flipIdx];
      flipIdx += 1;
      const inProfitBand = lockedPeakR >= 1.5;
      const isOpposite =
        (action === 'CE-BUY' && flip.oppositeAction === 'PE-BUY') ||
        (action === 'PE-BUY' && flip.oppositeAction === 'CE-BUY');
      if (enableFlipExit && inProfitBand && isOpposite) {
        const pnl = signedPnl(action, entry, close);
        return withScope({
          status: pnl > 0 ? 'TAKE_PROFIT' : 'SESSION_END',
          pnl,
          pnlR: +(pnl / risk).toFixed(3),
          exitPrice: +close.toFixed(2),
          exitAt: tsMs,
          exitAtISO: toIso(tsMs),
          hitLevel: 'SIGNAL_FLIP',
          barsHeld: i + 1,
        });
      }
    }

    if (action === 'CE-BUY') {
      if (low <= stopLoss) {
        return withScope({
          status: 'STOP_LOSS',
          pnl: signedPnl(action, entry, stopLoss),
          pnlR: -1,
          exitPrice: stopLoss,
          exitAt: tsMs,
          exitAtISO: toIso(tsMs),
          hitLevel: 'STOP_LOSS',
          barsHeld: i + 1,
        });
      }

      const touched = maxTierTouchedOnCandle(action, tiers, high, low);
      if (touched > peakTier) peakTier = touched;
      peakR = Math.max(peakR, peakRFromCandle(action, entry, risk, high, low));

      const floorExit = ratchetFloorExit(
        action,
        setup,
        lockedPeakR,
        close,
        tsMs,
        i + 1,
        withScope,
      );
      if (floorExit) return floorExit;
    } else {
      if (high >= stopLoss) {
        return withScope({
          status: 'STOP_LOSS',
          pnl: signedPnl(action, entry, stopLoss),
          pnlR: -1,
          exitPrice: stopLoss,
          exitAt: tsMs,
          exitAtISO: toIso(tsMs),
          hitLevel: 'STOP_LOSS',
          barsHeld: i + 1,
        });
      }

      const touched = maxTierTouchedOnCandle(action, tiers, high, low);
      if (touched > peakTier) peakTier = touched;
      peakR = Math.max(peakR, peakRFromCandle(action, entry, risk, high, low));

      const floorExit = ratchetFloorExit(
        action,
        setup,
        lockedPeakR,
        close,
        tsMs,
        i + 1,
        withScope,
      );
      if (floorExit) return floorExit;
    }
  }

  const lastCandle = forwardCandles[forwardCandles.length - 1];
  const exitPrice = lastCandle[4];
  const exitAt = lastCandle[0] * 1000;
  const pnl = signedPnl(action, entry, exitPrice);
  const unresolvedStatus =
    simulationScope === 'session' ? 'SESSION_END' : 'OPEN';

  const hitLevel =
    simulationScope === 'session'
      ? highestTouchedLabel(tiers, peakTier) === 'OPEN'
        ? 'SESSION_END'
        : highestTouchedLabel(tiers, peakTier)
      : highestTouchedLabel(tiers, peakTier);

  return withScope({
    status: unresolvedStatus,
    pnl,
    pnlR: +(pnl / risk).toFixed(3),
    exitPrice: +exitPrice.toFixed(2),
    exitAt,
    exitAtISO: toIso(exitAt),
    hitLevel,
    barsHeld: forwardCandles.length,
  });
}

export function isBenchmarkWin(
  status: TradeOutcome['status'],
  pnlR: number,
): boolean {
  return status === 'TAKE_PROFIT' || pnlR > 0.05;
}

export function isBenchmarkLoss(
  status: TradeOutcome['status'],
  pnlR: number,
): boolean {
  return status === 'STOP_LOSS' || pnlR < -0.05;
}