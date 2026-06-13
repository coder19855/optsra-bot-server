import { FastifyInstance } from 'fastify';
import { FYERS_OPTION_INDEX_SYMBOLS } from '../constants/fyers-symbols';
import { TELEGRAM_NOTIFICATION_DEFAULTS } from '../constants/telegram-notifications';
import { getStyleScoringConfig } from '../trading-style';
import { resolveOptionMeta } from '../trading-coach/symbol-utils';
import { ResponseStatus } from '../types/common';
import { PriceActionResponse } from '../types/technical-analysis';
import {
  OpenPositionMonitorContext,
  PositionTpEvaluation,
  TpAlertKind,
  TpHoldAdvice,
  TpMonitorSnapshot,
  TradeDecisionAlertPayload,
} from '../types/telegram-notifications';
import { DecisionAction } from '../types/trade-decision';
import { isIndexStopBreached } from './signal-exit-policy';

export type HeldDirection = 'CE-BUY' | 'PE-BUY';

export interface OpenPositionContext {
  positions: OpenPositionMonitorContext[];
  heldDirection: HeldDirection | null;
  isMixedDirections: boolean;
  count: number;
  fetchSucceeded: boolean;
  fetchError?: string;
}

/**
 * First-class Management Brain output.
 * This is the core improvement: when the user has live risk, the system produces
 * rich, actionable management guidance instead of (or in addition to) raw entry signals.
 */
export interface ManagementAdvice {
  mode: 'MANAGEMENT' | 'FLAT';
  heldDirection: HeldDirection | null;
  isMixedDirections: boolean;
  positionCount: number;

  /** High-level recommended stance for the existing position(s) */
  overall: 'STRONG_HOLD' | 'HOLD' | 'PARTIAL_BOOK' | 'TRAIL' | 'EXIT_SOON' | 'HARD_EXIT' | 'CONFLICT' | 'WATCH';

  headline: string;
  reasons: string[];

  /** Concrete actions the user should consider right now */
  recommendedActions: Array<{
    action: 'BOOK_PARTIAL' | 'BOOK_ALL' | 'MOVE_STOP_TO_BREAKEVEN' | 'TRAIL_STOP' | 'TIGHTEN_STOP' | 'MONITOR' | 'SCALE_OUT_AT_TP' | 'CONSIDER_ADD_ON_WEAKNESS';
    detail: string;
    rrTarget?: RrLabel | 'current' | 'breakeven';
  }>;

  currentR: number | null;
  highestHitRr: RrLabel | null;

  /** How well the current engine read supports the held direction */
  alignment: 'ALIGNED' | 'WEAKENING' | 'OPPOSITE' | 'NEUTRAL';

  /** 0-100 score of how suitable it is to continue holding the current position */
  holdSuitability: number;

  /** Suggested adjustments for risk on the existing position (not new entries) */
  riskAdjustment: {
    suggestedAction: 'MAINTAIN' | 'REDUCE_SIZE' | 'TIGHTEN_RISK' | 'LET_RUN';
    notes: string[];
  };

  /** Dynamic stop suggestion based on current market structure (if better than original) */
  suggestedStopAdjustment?: {
    newStop: number;
    reason: string;
    improvement: string;
  };

  source: 'live_position';

  /** 
   * Synthesized Position Health Score — the "at a glance" health of your open position.
   * This is a major UX improvement for the management brain.
   */
  positionHealth: PositionHealth;
}

export interface PositionHealth {
  score: number;                    // 0-100
  label: 'Excellent' | 'Good' | 'Fair' | 'Caution' | 'Exit Zone';
  trend: 'improving' | 'stable' | 'deteriorating' | 'unknown';
  breakdown: Array<{
    factor: string;
    contribution: number;           // -30 to +30 roughly
    note: string;
  }>;
  previousScore?: number;
}
import {
  RrLabel,
  TradeAction,
  TradeSetup,
  TradeTakeProfitLevel,
} from '../types/technical-analysis';
import { TradingStyle } from '../types/trading-style';
import { TelegramVoice } from '../types/telegram-voice';
import { fetchTradeDecisionAlert } from './trade-decision-fetch';
import {
  PollMarketDataContext,
  pollPriceActionCacheKey,
} from '../market-data/poll-market-data-context';
import { formatTelegramTpAlertMessage } from './tp-alert-formatter';
import { hasRecentTradeEntryIntent, pruneExpiredEntryIntents } from './trade-entry-intent';
import {
  buildTpMonitorSnapshot,
  buildUntrackedTpSnapshot,
  deleteTpSnapshot,
  detectTpAlertChange,
  loadTpSnapshot,
  saveTpSnapshot,
} from './tp-tracker';
import { TpTrackReason } from '../types/telegram-notifications';

const RR_ORDER: RrLabel[] = ['1:1', '1:2', '1:3'];

function shortIndexLabel(symbol: string): string {
  const meta = FYERS_OPTION_INDEX_SYMBOLS.find((row) => row.symbol === symbol);
  return meta?.shortName ?? symbol.split(':')[1]?.replace('-INDEX', '') ?? symbol;
}

function optionLabel(symbol: string): string {
  return symbol.split(':').pop() ?? symbol;
}

function positionDirection(optionType: 'CE' | 'PE'): 'CE-BUY' | 'PE-BUY' {
  return optionType === 'CE' ? 'CE-BUY' : 'PE-BUY';
}

function maxRr(a: RrLabel | null, b: RrLabel | null): RrLabel | null {
  if (!a) return b;
  if (!b) return a;
  return RR_ORDER.indexOf(a) >= RR_ORDER.indexOf(b) ? a : b;
}

function tpByRr(
  takeProfits: TradeTakeProfitLevel[],
  rr: RrLabel | null,
): TradeTakeProfitLevel | null {
  if (!rr) return null;
  return takeProfits.find((tp) => tp.rr === rr) ?? null;
}

function signalSupportsPosition(
  positionDirection: 'CE-BUY' | 'PE-BUY',
  signalAction: DecisionAction,
  paAction: string,
): boolean {
  if (positionDirection === 'CE-BUY') {
    return signalAction === 'CE-BUY' || paAction === 'CE-BUY';
  }
  return signalAction === 'PE-BUY' || paAction === 'PE-BUY';
}

function currentRMultiple(
  direction: TradeAction,
  spot: number,
  setup: TradeSetup,
): number {
  if (setup.risk <= 0) return 0;
  if (direction === 'CE-BUY') return (spot - setup.entry) / setup.risk;
  if (direction === 'PE-BUY') return (setup.entry - spot) / setup.risk;
  return 0;
}

function highestTpHit(
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

function nextTpLevel(
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

function distanceToTp(
  direction: TradeAction,
  spot: number,
  tp: TradeTakeProfitLevel,
): number {
  if (direction === 'CE-BUY') return Math.max(0, tp.price - spot);
  if (direction === 'PE-BUY') return Math.max(0, spot - tp.price);
  return 0;
}

function buildHoldGuidance(params: {
  tradingStyle: TradingStyle;
  conviction: number;
  momentumDecayPercent: number | null;
  aligned: boolean;
  highestHitRr: RrLabel | null;
  nextTpRr: RrLabel | null;
  currentR: number;
  approaching: boolean;
}): {
  holdAdvice: TpHoldAdvice;
  holdHeadline: string;
  holdReasons: string[];
  alertKind: TpAlertKind;
} {
  const thresholds = getStyleScoringConfig(params.tradingStyle).convictionThreshold;
  const reasons: string[] = [];

  if (!params.aligned) {
    return {
      holdAdvice: 'exit',
      holdHeadline: 'Signal no longer supports this position — book or cut size.',
      holdReasons: [
        'Engine direction has diverged from your open option leg.',
        'Do not hold a CE/PE position against a flipped or flat system read.',
      ],
      alertKind: 'SIGNAL_CONFLICT',
    };
  }

  if (params.momentumDecayPercent != null && params.momentumDecayPercent >= 25) {
    reasons.push(
      `Momentum decay is elevated (${params.momentumDecayPercent}%) — edge is fading.`,
    );
  }

  if (params.conviction < thresholds.enter) {
    reasons.push(
      `Conviction (${params.conviction}%) is below the ${params.tradingStyle} entry bar (${thresholds.enter}%).`,
    );
  }

  if (params.highestHitRr === '1:3') {
    return {
      holdAdvice: 'exit',
      holdHeadline: 'Full 1:3 index target reached — book remaining and protect gains.',
      holdReasons: [
        'Engine spot target at 1:3 is hit. Trail only if you have a separate discretionary plan.',
        ...reasons,
      ],
      alertKind: 'REACHED',
    };
  }

  if (params.highestHitRr === '1:2') {
    const canHold =
      params.conviction >= thresholds.strong &&
      (params.momentumDecayPercent ?? 0) < 20;
    return {
      holdAdvice: canHold ? 'trail' : 'partial',
      holdHeadline: canHold
        ? '1:2 target hit — trail stop and hold for 1:3 if momentum stays clean.'
        : '1:2 target hit — book partials; only runners with a tight trail.',
      holdReasons: canHold
        ? [
            `Conviction still strong (${params.conviction}% ≥ ${thresholds.strong}).`,
            'Move stop toward breakeven+ and let a reduced size work toward 1:3.',
            ...reasons,
          ]
        : [
            'Take meaningful profit at 1:2; conviction/momentum does not justify full size into 1:3.',
            ...reasons,
          ],
      alertKind: 'HOLD_REVIEW',
    };
  }

  if (params.highestHitRr === '1:1') {
    const canHold = params.conviction >= thresholds.enter;
    return {
      holdAdvice: canHold ? 'partial' : 'exit',
      holdHeadline: canHold
        ? '1:1 target reached — book partial, trail rest toward 1:2.'
        : '1:1 target reached — conviction weakened; prefer booking most of the trade.',
      holdReasons: canHold
        ? [
            'First target achieved. System still aligned — common playbook is 50% off + breakeven stop.',
            `Next engine target is 1:2${params.nextTpRr ? '' : ''}.`,
            ...reasons,
          ]
        : [
            'First target achieved but follow-through quality is poor — do not assume 1:2.',
            ...reasons,
          ],
      alertKind: 'HOLD_REVIEW',
    };
  }

  if (params.approaching && params.nextTpRr) {
    const canHold = params.conviction >= thresholds.medium;
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

/**
 * Position Health Score — synthesizes many signals into one intuitive 0-100 health metric
 * for an open position. This is what makes the management experience feel premium.
 */
export function computePositionHealthScore(
  positionContext: OpenPositionContext,
  decision: TradeDecisionAlertPayload,
  priceData: PriceActionResponse,
  tradingStyle: TradingStyle,
  previousHealthScore?: number,
): PositionHealth {
  const { heldDirection, count } = positionContext;

  if (!heldDirection || count === 0) {
    return {
      score: 50,
      label: 'Fair',
      trend: 'unknown',
      breakdown: [{ factor: 'No position', contribution: 0, note: 'No open leg detected' }],
    };
  }

  const tradeSetup = priceData.tradeSetup;
  const conviction = decision.conviction ?? 0;
  const momentumDecay = priceData.momentumDecay?.decayPercent ?? 0;
  const thresholds = getStyleScoringConfig(tradingStyle).convictionThreshold;

  const aligned = signalSupportsPosition(heldDirection, decision.action, decision.priceAction.action);
  const paMatches = decision.priceAction.action === heldDirection;

  let currentR = 0;
  let highestHitRr: RrLabel | null = null;
  if (tradeSetup?.risk && tradeSetup.risk > 0 && tradeSetup.takeProfits?.length) {
    currentR = currentRMultiple(heldDirection, priceData.lastPrice, tradeSetup);
    const spotHit = highestTpHit(heldDirection, priceData.lastPrice, tradeSetup.takeProfits);
    highestHitRr = spotHit?.rr ?? null;
  }

  const stopBreached = tradeSetup?.stopLoss
    ? isIndexStopBreached(heldDirection!, priceData.lastPrice, tradeSetup)
    : false;

  const breakdown: PositionHealth['breakdown'] = [];

  let score = 60; // neutral starting point for a live position

  // Alignment (very important)
  if (aligned && paMatches) {
    const bonus = 18;
    score += bonus;
    breakdown.push({ factor: 'Engine Alignment', contribution: bonus, note: 'Current signals support your held direction' });
  } else if (!aligned) {
    const penalty = -22;
    score += penalty;
    breakdown.push({ factor: 'Engine Alignment', contribution: penalty, note: 'Engine has turned against your position' });
  } else {
    const smallPenalty = -8;
    score += smallPenalty;
    breakdown.push({ factor: 'Engine Alignment', contribution: smallPenalty, note: 'Price action and overall signal are not perfectly in sync' });
  }

  // Conviction
  let convContrib = 0;
  if (conviction >= thresholds.strong) convContrib = 14;
  else if (conviction >= thresholds.enter) convContrib = 6;
  else convContrib = -16;
  score += convContrib;
  breakdown.push({ 
    factor: 'Conviction', 
    contribution: convContrib, 
    note: conviction >= thresholds.strong ? 'Strong confluence for the style' : conviction >= thresholds.enter ? 'Meets entry threshold' : 'Below style entry bar' 
  });

  // Momentum Decay (critical for options)
  let decayContrib = 0;
  if (momentumDecay >= 35) decayContrib = -28;
  else if (momentumDecay >= 22) decayContrib = -16;
  else if (momentumDecay >= 12) decayContrib = -6;
  else if (momentumDecay < 8) decayContrib = +5;
  score += decayContrib;
  if (Math.abs(decayContrib) > 2) {
    breakdown.push({ factor: 'Momentum Decay', contribution: decayContrib, note: `${momentumDecay.toFixed(0)}% decay — ${decayContrib < 0 ? 'edge fading' : 'momentum clean'}` });
  }

  // R-multiple achieved (profit already locked in)
  let rContrib = 0;
  if (currentR >= 2.5) rContrib = 12;
  else if (currentR >= 1.5) rContrib = 7;
  else if (currentR >= 0.8) rContrib = 2;
  else if (currentR < 0) rContrib = -10;
  score += rContrib;
  if (Math.abs(rContrib) > 1) {
    breakdown.push({ factor: 'R Multiple', contribution: rContrib, note: currentR >= 1.5 ? `Banked ${currentR.toFixed(1)}R` : `Only ${currentR.toFixed(1)}R so far` });
  }

  // TP milestones
  if (highestHitRr === '1:3') {
    score -= 8; // time to protect
    breakdown.push({ factor: 'TP Milestone', contribution: -8, note: '1:3 reached — protect profits' });
  } else if (highestHitRr === '1:2') {
    score += 4;
    breakdown.push({ factor: 'TP Milestone', contribution: 4, note: '1:2 achieved — good runner potential' });
  }

  // Stop / structure risk
  if (stopBreached) {
    score = Math.min(score, 18);
    breakdown.push({ factor: 'Stop Risk', contribution: -25, note: 'Stop level breached' });
  } else if (tradeSetup && priceData.levels) {
    const distToStop = heldDirection === 'CE-BUY' 
      ? priceData.lastPrice - tradeSetup.stopLoss 
      : tradeSetup.stopLoss - priceData.lastPrice;
    if (distToStop < (tradeSetup.risk || 10) * 0.6) {
      const penalty = -9;
      score += penalty;
      breakdown.push({ factor: 'Stop Proximity', contribution: penalty, note: 'Close to stop — manage risk tightly' });
    }
  }

  // Style adjustment (scalpers are more sensitive to decay)
  if (tradingStyle === 'SCALPER' && momentumDecay > 15) {
    score -= 6;
    breakdown.push({ factor: 'Style Fit', contribution: -6, note: 'High decay hurts scalping style more' });
  }

  // Clamp and label
  score = Math.max(5, Math.min(95, Math.round(score)));

  let label: PositionHealth['label'] = 'Fair';
  if (score >= 82) label = 'Excellent';
  else if (score >= 68) label = 'Good';
  else if (score >= 48) label = 'Fair';
  else if (score >= 32) label = 'Caution';
  else label = 'Exit Zone';

  // Trend
  let trend: PositionHealth['trend'] = 'unknown';
  if (previousHealthScore != null) {
    const delta = score - previousHealthScore;
    if (delta > 6) trend = 'improving';
    else if (delta < -6) trend = 'deteriorating';
    else trend = 'stable';
  }

  return {
    score,
    label,
    trend,
    breakdown: breakdown.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)).slice(0, 5),
    previousScore: previousHealthScore,
  };
}

/**
 * THE MANAGEMENT BRAIN.
 * 
 * This is the key improvement for pushing the bot toward 9/10.
 * It takes the raw entry-oriented decision + live Fyers positions and produces
 * a rich, position-centric set of advice.
 *
 * It does NOT change the core decision engine. It sits on top as the "management layer".
 */
export function computeManagementAdvice(
  positionContext: OpenPositionContext,
  decision: TradeDecisionAlertPayload,
  priceData: PriceActionResponse,
  tradingStyle: TradingStyle,
): ManagementAdvice {
  const { heldDirection, isMixedDirections, count } = positionContext;

  if (count === 0 || !heldDirection) {
    return {
      mode: 'FLAT',
      heldDirection: null,
      isMixedDirections: false,
      positionCount: 0,
      overall: 'WATCH',
      headline: 'No open positions on watched indexes.',
      reasons: [],
      recommendedActions: [{ action: 'MONITOR', detail: 'System is in entry mode.' }],
      currentR: null,
      highestHitRr: null,
      alignment: 'NEUTRAL',
      holdSuitability: 50,
      riskAdjustment: { suggestedAction: 'MAINTAIN', notes: [] },
      source: 'live_position',
      positionHealth: {
        score: 50,
        label: 'Fair',
        trend: 'unknown',
        breakdown: [{ factor: 'No position', contribution: 0, note: 'No open leg detected' }],
      },
    };
  }

  const tradeSetup = priceData.tradeSetup;

  // Base calculations (reuse existing helpers where possible)
  let currentR: number | null = null;
  let highestHitRr: RrLabel | null = null;

  if (tradeSetup?.risk && tradeSetup.risk > 0 && tradeSetup.takeProfits?.length) {
    currentR = currentRMultiple(heldDirection, priceData.lastPrice, tradeSetup);
    const spotHit = highestTpHit(heldDirection, priceData.lastPrice, tradeSetup.takeProfits);
    highestHitRr = spotHit?.rr ?? null;
  }

  const aligned = signalSupportsPosition(heldDirection, decision.action, decision.priceAction.action);
  const paMatches = decision.priceAction.action === heldDirection;
  const conviction = decision.conviction ?? 0;
  const momentumDecay = priceData.momentumDecay?.decayPercent ?? 0;

  const thresholds = getStyleScoringConfig(tradingStyle).convictionThreshold;

  // Alignment assessment
  let alignment: ManagementAdvice['alignment'] = 'ALIGNED';
  if (!aligned) alignment = 'OPPOSITE';
  else if (momentumDecay >= 25 || conviction < thresholds.enter) alignment = 'WEAKENING';
  else if (!paMatches) alignment = 'WEAKENING';

  // Hold suitability score (0-100) - this is the heart of the management brain
  let holdSuitability = 65; // baseline

  if (aligned && paMatches) holdSuitability += 20;
  if (conviction >= thresholds.strong) holdSuitability += 12;
  else if (conviction < thresholds.enter) holdSuitability -= 18;

  if (momentumDecay >= 30) holdSuitability -= 25;
  else if (momentumDecay >= 15) holdSuitability -= 10;

  if (highestHitRr === '1:3') holdSuitability -= 15; // time to book
  if (highestHitRr === '1:2') holdSuitability += 5; // can trail

  // Stop breach check using current structure (better than static)
  const currentStopBreached = tradeSetup?.stopLoss
    ? isIndexStopBreached(heldDirection!, priceData.lastPrice, tradeSetup)
    : false;

  if (currentStopBreached) holdSuitability = Math.min(holdSuitability, 15);

  holdSuitability = Math.max(5, Math.min(95, Math.round(holdSuitability)));

  // Determine overall stance
  let overall: ManagementAdvice['overall'] = 'HOLD';
  const reasons: string[] = [];

  if (currentStopBreached) {
    overall = 'HARD_EXIT';
    reasons.push('Index stop level has been breached.');
  } else if (!aligned && conviction < 45) {
    overall = 'EXIT_SOON';
    reasons.push('Engine has flipped or significantly weakened against your held direction.');
  } else if (alignment === 'WEAKENING' && momentumDecay >= 20) {
    overall = 'PARTIAL_BOOK';
    reasons.push('Momentum decay elevated and conviction softening — book some size.');
  } else if (highestHitRr === '1:3') {
    overall = 'PARTIAL_BOOK';
    reasons.push('Full 1:3 target achieved — protect gains.');
  } else if (highestHitRr === '1:2' && conviction >= thresholds.strong) {
    overall = 'TRAIL';
    reasons.push('1:2 hit with strong conviction — trail for 1:3.');
  } else if (holdSuitability < 40) {
    overall = 'EXIT_SOON';
    reasons.push(`Hold suitability is low (${holdSuitability}%).`);
  } else if (holdSuitability >= 80 && alignment === 'ALIGNED') {
    overall = 'STRONG_HOLD';
  } else if (holdSuitability < 55) {
    overall = 'CONFLICT';
  }

  // Build concrete recommended actions (this is what makes it feel like a real management brain)
  const recommendedActions: ManagementAdvice['recommendedActions'] = [];

  if (overall === 'HARD_EXIT' || overall === 'EXIT_SOON') {
    recommendedActions.push({ action: 'BOOK_ALL', detail: 'Exit the position — engine no longer supports the trade.' });
  } else if (overall === 'PARTIAL_BOOK') {
    recommendedActions.push({ action: 'BOOK_PARTIAL', detail: 'Book 40-60% into strength or at current R-multiple.', rrTarget: highestHitRr ?? 'current' });
    recommendedActions.push({ action: 'MOVE_STOP_TO_BREAKEVEN', detail: 'Move stop to breakeven or better on remaining size.' });
  } else if (overall === 'TRAIL') {
    recommendedActions.push({ action: 'TRAIL_STOP', detail: 'Trail stop toward breakeven+ and let runner work toward 1:3.' });
  } else if (overall === 'STRONG_HOLD') {
    recommendedActions.push({ action: 'MONITOR', detail: 'Position is well supported — stay disciplined on original plan.' });
  } else {
    recommendedActions.push({ action: 'MONITOR', detail: 'Continue monitoring key levels and conviction.' });
  }

  // Risk adjustment for the *existing* position
  let riskAdjustment: ManagementAdvice['riskAdjustment'] = { suggestedAction: 'MAINTAIN', notes: [] };
  if (momentumDecay >= 20 || conviction < thresholds.enter) {
    riskAdjustment = { suggestedAction: 'REDUCE_SIZE', notes: ['Reduce risk on the position due to weakening signals.'] };
  } else if (holdSuitability >= 80) {
    riskAdjustment = { suggestedAction: 'LET_RUN', notes: ['Conviction remains healthy for the held direction.'] };
  }

  // Dynamic stop suggestion from current structure (big management brain win)
  let suggestedStopAdjustment: ManagementAdvice['suggestedStopAdjustment'] | undefined;
  if (tradeSetup && priceData.levels) {
    const structureStop = heldDirection === 'CE-BUY' ? priceData.levels.support : priceData.levels.resistance;
    if (structureStop && Math.abs(structureStop - tradeSetup.stopLoss) > 3) {
      const better = heldDirection === 'CE-BUY' ? structureStop > tradeSetup.stopLoss : structureStop < tradeSetup.stopLoss;
      if (better) {
        suggestedStopAdjustment = {
          newStop: +structureStop.toFixed(2),
          reason: 'Current swing structure offers a tighter, more relevant stop than the original.',
          improvement: 'Tighter risk while still giving the trade room.',
        };
      }
    }
  }

  // Headline
  let headline = `Holding ${heldDirection} — `;
  if (overall === 'STRONG_HOLD') headline += 'strong alignment, manage for extension.';
  else if (overall === 'TRAIL') headline += '1:2+ reached — trail and manage runner.';
  else if (overall === 'PARTIAL_BOOK') headline += 'book partials and protect.';
  else if (overall === 'HARD_EXIT' || overall === 'EXIT_SOON') headline += 'reduce or exit — signals no longer supportive.';
  else headline += 'monitor key levels and conviction.';

  // === Position Health Score (the interesting new piece) ===
  const positionHealth = computePositionHealthScore(positionContext, decision, priceData, tradingStyle);

  // Use health to influence overall stance and actions (makes the brain smarter)
  if (positionHealth.score < 35 && !['HARD_EXIT', 'EXIT_SOON'].includes(overall)) {
    overall = 'EXIT_SOON';
    if (!reasons.some(r => r.includes('health'))) {
      reasons.push(`Position health is critically low (${positionHealth.score}).`);
    }
    recommendedActions.unshift({ action: 'BOOK_PARTIAL', detail: 'Health score in Exit Zone — book at least 50% immediately.' });
  } else if (positionHealth.score < 50 && overall === 'HOLD') {
    overall = 'CONFLICT';
    recommendedActions.unshift({ action: 'BOOK_PARTIAL', detail: 'Health below 50 — consider booking 30-50% to de-risk.' });
  }

  return {
    mode: 'MANAGEMENT',
    heldDirection,
    isMixedDirections,
    positionCount: count,
    overall,
    headline,
    reasons: reasons.length ? reasons : ['Current engine read evaluated against your live position.'],
    recommendedActions,
    currentR,
    highestHitRr,
    alignment,
    holdSuitability,
    riskAdjustment,
    suggestedStopAdjustment,
    positionHealth,
    source: 'live_position',
  };
}

export async function fetchOpenIndexOptionPositions(
  fastify: FastifyInstance,
  watchedIndexSymbols: string[],
): Promise<OpenPositionMonitorContext[]> {
  try {
    const res = await fastify.fyers.get_positions();
    if (res.s !== ResponseStatus.ok || !res.netPositions?.length) return [];

    const watched = new Set(watchedIndexSymbols);
    const positions: OpenPositionMonitorContext[] = [];

    for (const row of res.netPositions) {
      const netQty = Number(row.netQty ?? row.qty ?? 0);
      if (netQty <= 0) continue;

      const meta = resolveOptionMeta(row.symbol);
      if (!meta || !watched.has(meta.indexSymbol)) continue;

      positions.push({
        symbol: row.symbol,
        optionLabel: optionLabel(row.symbol),
        indexSymbol: meta.indexSymbol,
        indexLabel: shortIndexLabel(meta.indexSymbol),
        direction: positionDirection(meta.optionType),
        netQty,
        buyAvg: Number(row.buyAvg ?? 0),
        unrealizedPnl: Number(row.unrealized_profit ?? row.pl ?? 0),
      });
    }

    return positions;
  } catch (err) {
    fastify.log?.warn?.({ err, watched: watchedIndexSymbols }, 'fetchOpenIndexOptionPositions failed');
    return [];
  }
}

/**
 * Robust wrapper around position fetching.
 * Always returns a context object even on errors.
 * Computes heldDirection only when there is exactly one unique direction.
 * Exposes isMixedDirections and fetch status for callers to decide how to degrade.
 */
export async function getOpenPositionContext(
  fastify: FastifyInstance,
  indexSymbols: string[],
): Promise<OpenPositionContext> {
  const empty: OpenPositionContext = {
    positions: [],
    heldDirection: null,
    isMixedDirections: false,
    count: 0,
    fetchSucceeded: false,
  };

  try {
    const positions = await fetchOpenIndexOptionPositions(fastify, indexSymbols);
    const count = positions.length;

    if (count === 0) {
      return { ...empty, fetchSucceeded: true, count: 0 };
    }

    const directions = positions.map((p) => p.direction);
    const unique = [...new Set(directions)];
    const isMixed = unique.length > 1;
    const held = isMixed ? null : (unique[0] as HeldDirection);

    return {
      positions,
      heldDirection: held,
      isMixedDirections: isMixed,
      count,
      fetchSucceeded: true,
    };
  } catch (err: any) {
    const msg = err?.message || String(err);
    fastify.log?.warn?.({ err, symbols: indexSymbols }, 'getOpenPositionContext failed to fetch positions');
    return { ...empty, fetchError: msg };
  }
}

/** Convenience: true if there is at least one open leg for the index (regardless of mixed or tracking). */
export async function hasLiveOpenPosition(
  fastify: FastifyInstance,
  indexSymbol: string,
): Promise<boolean> {
  try {
    const ctx = await getOpenPositionContext(fastify, [indexSymbol]);
    return ctx.fetchSucceeded && ctx.count > 0;
  } catch {
    return false;
  }
}

async function fetchPriceAction(
  fastify: FastifyInstance,
  indexSymbol: string,
  tradingStyle: TradingStyle,
  cache: Map<string, PriceActionResponse>,
): Promise<PriceActionResponse | null> {
  const cacheKey = pollPriceActionCacheKey(indexSymbol, tradingStyle);
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const paRes = await fastify.inject({
    method: 'GET',
    url: `/api/technical-analysis?symbol=${encodeURIComponent(indexSymbol)}&tradingStyle=${tradingStyle}`,
  });
  if (paRes.statusCode !== 200) return null;

  const priceData = JSON.parse(paRes.body) as PriceActionResponse;
  cache.set(cacheKey, priceData);
  return priceData;
}

function evaluatePositionTp(
  position: OpenPositionMonitorContext,
  tradingStyle: TradingStyle,
  decision: TradeDecisionAlertPayload,
  priceData: PriceActionResponse,
  previous: TpMonitorSnapshot | null,
): PositionTpEvaluation | null {
  const tradeSetup = priceData.tradeSetup;
  if (!tradeSetup || tradeSetup.risk <= 0 || !tradeSetup.takeProfits?.length) {
    return null;
  }

  const spot = priceData.lastPrice;
  const spotHit = highestTpHit(position.direction, spot, tradeSetup.takeProfits);
  const effectiveHitRr = maxRr(previous?.highestTpRr ?? null, spotHit?.rr ?? null);
  const highestHitTp = tpByRr(tradeSetup.takeProfits, effectiveHitRr);
  const nextTp = nextTpLevel(position.direction, spot, tradeSetup.takeProfits);
  const currentR = currentRMultiple(position.direction, spot, tradeSetup);
  const distanceToNextPoints = nextTp
    ? distanceToTp(position.direction, spot, nextTp)
    : null;
  const distanceToNextR =
    distanceToNextPoints != null && tradeSetup.risk > 0
      ? distanceToNextPoints / tradeSetup.risk
      : null;

  const approachThreshold = Math.max(
    TELEGRAM_NOTIFICATION_DEFAULTS.TP_APPROACH_MIN_POINTS,
    tradeSetup.risk * TELEGRAM_NOTIFICATION_DEFAULTS.TP_APPROACH_WITHIN_R,
  );

  const approaching =
    nextTp != null &&
    distanceToNextPoints != null &&
    distanceToNextR != null &&
    distanceToNextPoints <= approachThreshold &&
    distanceToNextR <= TELEGRAM_NOTIFICATION_DEFAULTS.TP_APPROACH_WITHIN_R + 0.05;

  const aligned = signalSupportsPosition(
    position.direction,
    decision.action,
    decision.priceAction.action,
  );

  const guidance = buildHoldGuidance({
    tradingStyle,
    conviction: decision.conviction,
    momentumDecayPercent: priceData.momentumDecay?.decayPercent ?? null,
    aligned,
    highestHitRr: effectiveHitRr,
    nextTpRr: nextTp?.rr ?? null,
    currentR,
    approaching,
  });

  return {
    position,
    tradingStyle,
    spot,
    tradeSetup,
    signalAction: decision.action,
    paAction: decision.priceAction.action,
    bias: decision.bias,
    conviction: decision.conviction,
    momentumDecayPercent: priceData.momentumDecay?.decayPercent ?? null,
    currentR,
    highestHitTp,
    nextTp,
    distanceToNextPoints,
    distanceToNextR,
    alertKind: guidance.alertKind,
    holdAdvice: guidance.holdAdvice,
    holdHeadline: guidance.holdHeadline,
    holdReasons: guidance.holdReasons,
  };
}

async function resolveTrackingEligibility(
  fastify: FastifyInstance,
  params: {
    position: OpenPositionMonitorContext;
    tradingStyle: TradingStyle;
    decision: TradeDecisionAlertPayload;
    priceData: PriceActionResponse;
    previous: TpMonitorSnapshot | null;
  },
): Promise<{ isTracked: boolean; trackReason: TpTrackReason }> {
  if (params.previous?.isTracked) {
    return { isTracked: true, trackReason: 'already_tracked' };
  }

  const hasSetup =
    Boolean(params.priceData.tradeSetup?.risk) &&
    (params.priceData.tradeSetup?.takeProfits?.length ?? 0) > 0;

  if (!hasSetup) {
    return { isTracked: false, trackReason: null };
  }

  const hasIntent = await hasRecentTradeEntryIntent(fastify, {
    indexSymbol: params.position.indexSymbol,
    tradingStyle: params.tradingStyle,
    direction: params.position.direction,
  });

  if (hasIntent) {
    return { isTracked: true, trackReason: 'entry_alert' };
  }

  // NEW: Robust live position awareness.
  // If Fyers actually shows a net long leg for this exact option, we should manage it
  // (TP levels, stop breach, alignment) even if the user entered manually or the
  // intent window expired or the current index decision is flat.
  const liveCtx = await getOpenPositionContext(fastify, [params.position.indexSymbol]);
  const hasLiveMatchingLeg = liveCtx.fetchSucceeded &&
    liveCtx.positions.some(
      (p) => p.symbol === params.position.symbol && p.direction === params.position.direction
    );

  if (hasLiveMatchingLeg) {
    return { isTracked: true, trackReason: 'live_position' };
  }

  const aligned = signalSupportsPosition(
    params.position.direction,
    params.decision.action,
    params.decision.priceAction.action,
  );
  const paMatches = params.decision.priceAction.action === params.position.direction;
  const tradeReady = params.decision.tradeGuidance.shouldConsiderTrade;

  if (aligned && paMatches && tradeReady) {
    return { isTracked: true, trackReason: 'live_aligned' };
  }

  return { isTracked: false, trackReason: null };
}

export async function evaluateOpenPositionTpAlerts(
  fastify: FastifyInstance,
  params: {
    watchedSymbols: string[];
    tradingStyle: TradingStyle;
    tpMemory: Map<string, TpMonitorSnapshot>;
    sendMessage: (text: string) => Promise<void>;
    voice?: TelegramVoice;
    force?: boolean;
    pollContext?: PollMarketDataContext;
  },
): Promise<{ monitored: number; tracked: number; notified: number }> {
  await pruneExpiredEntryIntents(fastify);

  const positions = await fetchOpenIndexOptionPositions(
    fastify,
    params.watchedSymbols,
  );

  if (positions.length === 0) {
    const staleKeys = [...params.tpMemory.keys()];
    for (const key of staleKeys) {
      const snap = params.tpMemory.get(key);
      if (!snap) continue;
      await deleteTpSnapshot(fastify, params.tpMemory, snap.positionSymbol);
    }
    return { monitored: 0, tracked: 0, notified: 0 };
  }

  const openSymbols = new Set(positions.map((p) => p.symbol));
  for (const snap of params.tpMemory.values()) {
    if (!openSymbols.has(snap.positionSymbol)) {
      await deleteTpSnapshot(fastify, params.tpMemory, snap.positionSymbol);
    }
  }

  const decisionCache =
    params.pollContext?.tradeDecisionCache ??
    new Map<string, TradeDecisionAlertPayload>();
  const priceActionCache =
    params.pollContext?.priceActionCache ??
    new Map<string, PriceActionResponse>();
  let notified = 0;
  let tracked = 0;

  for (const position of positions) {
    const decisionKey = `${position.indexSymbol}:${params.tradingStyle}`;
    let decision = decisionCache.get(decisionKey);
    if (!decision) {
      try {
        const fetched = await fetchTradeDecisionAlert(
          fastify,
          position.indexSymbol,
          params.tradingStyle,
          {
            vetoMode: fastify.telegramNotifications.getVetoMode(),
            flowMode: fastify.telegramNotifications.getFlowMode(),
            pollContext: params.pollContext,
          },
        );
        if (!fetched) continue;
        decision = fetched;
        decisionCache.set(decisionKey, decision);
      } catch (err) {
        fastify.log.warn(
          { err, position: position.symbol },
          'TP monitor skipped — trade decision unavailable',
        );
        continue;
      }
    }

    const priceData = await fetchPriceAction(
      fastify,
      position.indexSymbol,
      params.tradingStyle,
      priceActionCache,
    );
    if (!priceData) continue;

    const previous = await loadTpSnapshot(
      fastify,
      params.tpMemory,
      position.symbol,
    );

    const tracking = await resolveTrackingEligibility(fastify, {
      position,
      tradingStyle: params.tradingStyle,
      decision,
      priceData,
      previous,
    });

    if (!tracking.isTracked) {
      await saveTpSnapshot(
        fastify,
        params.tpMemory,
        buildUntrackedTpSnapshot(position.symbol, previous),
      );
      continue;
    }

    tracked += 1;

    const evaluation = evaluatePositionTp(
      position,
      params.tradingStyle,
      decision,
      priceData,
      previous,
    );
    if (!evaluation) continue;

    // Attach the rich Management Brain advice (with Position Health Score + trend) to every TP evaluation.
    try {
      const posCtxForEval: OpenPositionContext = {
        positions: [position],
        heldDirection: position.direction,
        isMixedDirections: false,
        count: 1,
        fetchSucceeded: true,
      };
      const prevHealth = previous?.lastPositionHealthScore;
      evaluation.managementAdvice = computeManagementAdvice(posCtxForEval, decision, priceData, params.tradingStyle);
      // Re-compute health with previous for accurate trend (the one inside computeManagementAdvice uses default)
      if (evaluation.managementAdvice) {
        evaluation.managementAdvice.positionHealth = computePositionHealthScore(
          posCtxForEval, decision, priceData, params.tradingStyle, prevHealth
        );
      }
    } catch {}

    const change = detectTpAlertChange(previous, evaluation, {
      isTracked: tracking.isTracked,
    });
    const shouldSend =
      tracking.isTracked && (params.force || change.shouldNotify);

    if (shouldSend && change.kinds.length > 0) {
      const message = formatTelegramTpAlertMessage({
        evaluation,
        kinds: change.kinds,
        voice: params.voice,
      });
      await params.sendMessage(message);
      notified += 1;
    }

    await saveTpSnapshot(
      fastify,
      params.tpMemory,
      buildTpMonitorSnapshot(evaluation, previous, shouldSend, tracking),
    );
  }

  return { monitored: positions.length, tracked, notified };
}