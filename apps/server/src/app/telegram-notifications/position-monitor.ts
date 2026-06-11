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
import {
  RrLabel,
  TradeAction,
  TradeSetup,
  TradeTakeProfitLevel,
} from '../types/technical-analysis';
import { TradingStyle } from '../types/trading-style';
import { TelegramVoice } from '../types/telegram-voice';
import { fetchTradeDecisionAlert } from './trade-decision-fetch';
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

export async function fetchOpenIndexOptionPositions(
  fastify: FastifyInstance,
  watchedIndexSymbols: string[],
): Promise<OpenPositionMonitorContext[]> {
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
}

async function fetchPriceAction(
  fastify: FastifyInstance,
  indexSymbol: string,
  tradingStyle: TradingStyle,
  cache: Map<string, PriceActionResponse>,
): Promise<PriceActionResponse | null> {
  const cacheKey = `${indexSymbol}:${tradingStyle}`;
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

  const decisionCache = new Map<string, TradeDecisionAlertPayload>();
  const priceActionCache = new Map<string, PriceActionResponse>();
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