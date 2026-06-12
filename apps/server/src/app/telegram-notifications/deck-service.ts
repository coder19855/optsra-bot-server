import { FastifyInstance } from 'fastify';
import { ResponseStatus } from '../types/common';
import { getStyleScoringConfig } from '../trading-style';
import { TradingStyle } from '../types/trading-style';
import {
  ConfluenceContext,
  PriceActionResponse,
  TimelineMomentumDecay,
  TimelinePoint,
  Timeframe,
} from '../types/technical-analysis';
import {
  buildOptionComponentGauges,
  buildPriceActionComponentGauges,
  buildReplayPaComponents,
  DeckComponentGauge,
} from './deck-components';
import {
  buildDeckVetoBreakup,
  buildReplayVetoBreakup,
  DeckVetoBreakupItem,
} from './deck-veto-breakup';
import {
  buildPaDrilldown,
  buildPaDrilldownFromTimelinePoint,
  PaDrilldown,
} from './deck-pa-drilldown';
import {
  buildDeckPatternContext,
  buildIstChartSession,
  DeckPatternContext,
} from './deck-pattern-context';
import {
  DeckStrategyPayload,
  extractDeckStrategyPayload,
} from './deck-strategy';
import { buildDeckGauges, computeReplayOptionNeedle } from './deck-gauge';
import {
  loadOptionChainSnapshotsForSession,
  nearestOptionChainSnapshot,
} from './option-chain-snapshot-store';
import { getIstSessionClock, isIndianMarketOpen } from './signal-tracker';
import { loadFlowPreference } from './flow-preference';
import { loadVetoPreference, VetoMode } from './veto-preference';
import { FlowMode } from '../types/flow-mode';
import { isVetoOff } from '../types/veto-mode';

function resolveEntryThreshold(
  decision: { convictionThresholds?: { enter?: number } },
  style: TradingStyle,
): number {
  return (
    decision.convictionThresholds?.enter ??
    getStyleScoringConfig(style).convictionThreshold.enter
  );
}

function parseTradingStyle(styleQuery?: string): TradingStyle {
  const styleStr = (styleQuery || 'INTRADAY').toUpperCase();
  if (styleStr === 'SCALPER' || styleStr === TradingStyle.Scalper) {
    return TradingStyle.Scalper;
  }
  if (styleStr === 'POSITIONAL' || styleStr === TradingStyle.Positional) {
    return TradingStyle.Positional;
  }
  return TradingStyle.Intraday;
}

function primaryTimeframeForStyle(style: TradingStyle): '5m' | '15m' | '1h' {
  if (style === TradingStyle.Scalper) return '5m';
  if (style === TradingStyle.Positional) return '1h';
  return '15m';
}

function shortSymbol(symbol: string): string {
  const part = symbol.split(':')[1] || symbol;
  return part.replace('-INDEX', '');
}

function mergeSpotSeriesWithStream(
  timelineSeries: DeckSpotPoint[],
  streamSeries: DeckSpotPoint[],
): DeckSpotPoint[] {
  if (!streamSeries.length) return timelineSeries;
  const cutoff = streamSeries[0].t;
  const base = timelineSeries.filter((p) => p.t < cutoff);
  return [...base, ...streamSeries];
}

function resolveLiveIndexPrice(
  fastify: FastifyInstance,
  indexSymbol: string,
  fallback: number,
): number {
  const streamed = fastify.fyersMarketStream?.getIndexLtp(indexSymbol);
  return streamed ?? fallback;
}

export interface DeckSpotPoint {
  t: number;
  v: number;
}

export interface DeckCandlePoint {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

export interface DeckMarker {
  t: number;
  type: 'signal' | 'trade' | 'flip';
  label: string;
  action?: string;
}

export interface DeckReplayPoint {
  t: number;
  spot: number;
  optionNeedle: number;
  paNeedle: number;
  /** Lane fill % — matches live `gauges.option.percent` when liveSynced. */
  optionPercent?: number;
  /** Lane fill % — matches live `gauges.priceAction.percent` when liveSynced. */
  paPercent?: number;
  paGhost?: number | null;
  conviction: number;
  action: string;
  vetoed: boolean;
  vetoReason?: string;
  structuralAction?: string;
  whatIfAction: string;
  whatIfConviction: number;
  paComponents: DeckComponentGauge[];
  paDrilldown?: PaDrilldown;
  optionComponents?: DeckComponentGauge[];
  vetoBreakup?: DeckVetoBreakupItem[];
  /** Last scrub point overwritten from trade-decision so replay max === live. */
  liveSynced?: boolean;
}

export interface DeckVetoPoint {
  t: number;
  vetoed: boolean;
  action: string;
  structuralAction?: string;
  vetoReason?: string;
}

export interface DeckTradeMarker {
  t: number;
  symbol: string;
  pnlInr: number;
  verdict: string;
  label: string;
}

export interface DeckEvent {
  t: number;
  type: 'flip' | 'veto' | 'veto_clear' | 'trade' | 'signal';
  label: string;
  detail?: string;
  action?: string;
}

export interface DeckLiveStreamTick {
  type: 'tick';
  asOf: string;
  marketOpen: boolean;
  action: string;
  bias: string;
  conviction: number;
  entryThreshold: number;
  lastPrice: number;
  chartVetoed: boolean;
  gauges: ReturnType<typeof buildDeckGauges>;
  lanes: {
    optionPercent: number;
    priceActionPercent: number;
    combinedPercent: number;
  };
  spotSeries: DeckSpotPoint[];
  optionComponents: DeckComponentGauge[];
  priceActionComponents: DeckComponentGauge[];
  paDrilldown: PaDrilldown;
  vetoBreakup: DeckVetoBreakupItem[];
  flowMode: FlowMode;
  vetoReason?: string;
  structuralAction?: string;
  patternContext?: DeckPatternContext;
}

export interface DeckLivePayload {
  mode: 'live';
  symbol: string;
  symbolLabel: string;
  tradingStyle: string;
  asOf: string;
  marketOpen: boolean;
  action: string;
  bias: string;
  conviction: number;
  entryThreshold: number;
  lastPrice: number;
  chartVetoed: boolean;
  vetoMode: VetoMode;
  vetoOff: boolean;
  flowMode: FlowMode;
  gauges: ReturnType<typeof buildDeckGauges>;
  lanes: {
    optionPercent: number;
    priceActionPercent: number;
    combinedPercent: number;
  };
  spotSeries: DeckSpotPoint[];
  spotCandles: DeckCandlePoint[];
  convictionSeries: Array<{
    t: number;
    option: number;
    priceAction: number;
    combined: number;
  }>;
  markers: DeckMarker[];
  events: DeckEvent[];
  optionComponents: DeckComponentGauge[];
  priceActionComponents: DeckComponentGauge[];
  paDrilldown: PaDrilldown;
  vetoTimeline: DeckVetoPoint[];
  vetoReason?: string;
  structuralAction?: string;
  vetoBreakup: DeckVetoBreakupItem[];
  strategyRecommendation: DeckStrategyPayload;
  patternContext?: DeckPatternContext;
}

export interface DeckReplayPayload {
  mode: 'replay';
  symbol: string;
  symbolLabel: string;
  tradingStyle: string;
  sessionDate: string;
  entryThreshold: number;
  gauges: ReturnType<typeof buildDeckGauges>;
  replayPoints: DeckReplayPoint[];
  spotSeries: DeckSpotPoint[];
  spotCandles: DeckCandlePoint[];
  pnlSeries: Array<{ t: number; v: number }>;
  trades: DeckTradeMarker[];
  markers: DeckMarker[];
  events: DeckEvent[];
  optionComponents: DeckComponentGauge[];
  optionComponentsNote: string;
  vetoTimeline: DeckVetoPoint[];
  vetoMode: VetoMode;
  flowMode: FlowMode;
  vetoBreakup: DeckVetoBreakupItem[];
  strategyRecommendation: DeckStrategyPayload;
  pnlNote?: string;
}

async function fetchTradeDecision(
  fastify: FastifyInstance,
  symbol: string,
  tradingStyle: TradingStyle,
  vetoMode: VetoMode = 'strict',
  flowMode: FlowMode = 'blend',
) {
  const vetoQuery = `&vetoMode=${encodeURIComponent(vetoMode)}`;
  const flowQuery = `&flowMode=${encodeURIComponent(flowMode)}`;
  const res = await fastify.inject({
    method: 'GET',
    url: `/api/trade-decision?symbol=${encodeURIComponent(symbol)}&tradingStyle=${tradingStyle}${vetoQuery}${flowQuery}`,
  });
  if (res.statusCode !== 200) {
    throw new Error(`trade-decision failed (${res.statusCode})`);
  }
  return JSON.parse(res.body) as {
    symbol: string;
    lastPrice: number;
    tradingStyle: string;
    action: string;
    bias: string;
    conviction: number;
    priceConviction?: number;
    priceConvictionBeforeDecay?: number;
    optionConviction?: number;
    momentumDecay?: { decayPercent: number; reasons?: string[] };
    convictionThresholds?: { enter: number };
    priceAction: {
      components: Record<string, { score: number }>;
      levels?: { support: number; resistance: number };
      atr?: Record<string, number>;
      adx?: Record<string, number>;
      momentum?: {
        recent?: Record<string, number>;
        fakeout?: Record<string, number>;
      };
      structureElements?: PriceActionResponse['structureElements'];
      overallSignal: {
        confidence: number;
        action: string;
        strength?: string;
        vetoReason?: string;
        structuralAction?: string;
        confidenceBeforeDecay?: number;
      };
    };
    recommendation?: string;
    humanSummary?: string;
    tradeGuidance?: {
      shouldConsiderTrade?: boolean;
      sizeRecommendation?: string;
      notes?: string;
      thresholdsForThisStyle?: {
        enter: number;
        strong: number;
        cautionBelow: number;
      };
      scoringWeights?: {
        priceAction: number;
        optionFlow: number;
      };
    };
    risk?: {
      suggestedRiskPercent?: number;
      notes?: string[];
    };
    recommendedStrategies?: Array<{
      strategy?: string;
      risk?: string;
      confidenceScore?: number;
      reason?: string;
      executionHint?: string;
      riskManagement?: {
        positionSizing?: string;
        stopLoss?: string;
        takeProfit?: string;
        exitStrategy?: string;
      };
    }>;
    optionFlow: {
      bias: string;
      overallScore?: number;
      ivRegime?: string;
      greeksStrikeInsight?: DeckStrategyPayload['greeksStrikeInsight'];
      exactStrikeRecommendation?: DeckStrategyPayload['exactStrike'];
      components: Array<{
        name: string;
        score: number;
        interpretation?: string;
        weightage?: number;
      }>;
    };
    confluenceAndDecision: Array<{ field: string; value: number | string }>;
    _debug?: {
      rawPrice?: {
        primaryTimeframe?: string;
        timeframeScores?: Record<Timeframe, number>;
        confluence?: {
          mtfScore?: number;
          aligned?: number;
          higherTimeframeConfirmation?: boolean;
          summary?: string;
        };
        confluenceContext?: ConfluenceContext;
        candlestick?: Record<string, string>;
        momentumDecay?: TimelineMomentumDecay;
        signal?: { vetoedByDecay?: boolean };
      };
    };
  };
}

function extractPatternContext(
  decision: Awaited<ReturnType<typeof fetchTradeDecision>>,
  spotSeries: DeckSpotPoint[],
  anchorMs = Date.now(),
): DeckPatternContext | undefined {
  const rawPrice = decision._debug?.rawPrice as PriceActionResponse | undefined;
  if (!rawPrice) return undefined;
  return buildDeckPatternContext(rawPrice, spotSeries, anchorMs);
}

function prependPatternFormingEvent(
  events: DeckEvent[],
  patternContext?: DeckPatternContext,
): DeckEvent[] {
  if (
    !patternContext?.chart ||
    patternContext.chartStatus !== 'forming' ||
    !patternContext.label
  ) {
    return events;
  }

  const t = patternContext.markers.at(-1)?.t ?? Date.now();
  if (events.some((e) => e.type === 'signal' && e.label === 'Pattern forming')) {
    return events;
  }

  return [
    {
      t,
      type: 'signal',
      label: 'Pattern forming',
      detail: patternContext.label,
    },
    ...events,
  ];
}

function filterCandlesToIstSession(
  candles: DeckCandlePoint[],
  session: { fromMs: number; closeMs: number },
): DeckCandlePoint[] {
  const filtered = candles.filter(
    (c) => c.t >= session.fromMs && c.t <= session.closeMs + 5 * 60 * 1000,
  );
  return filtered.length ? filtered : candles;
}

function extractPaDrilldown(
  decision: Awaited<ReturnType<typeof fetchTradeDecision>>,
): PaDrilldown {
  const primaryTf = primaryTimeframeForStyle(
    decision.tradingStyle as TradingStyle,
  );
  const pa = decision.priceAction;
  const raw = decision._debug?.rawPrice;
  const components = pa.components;

  return buildPaDrilldown({
    primaryTimeframe: (raw?.primaryTimeframe as Timeframe) ?? primaryTf,
    timeframeScores: raw?.timeframeScores ?? {
      '5m': components['5m']?.score ?? 0,
      '15m': components['15m']?.score ?? 0,
      '1h': components['1h']?.score ?? 0,
    },
    mtfScore: raw?.confluence?.mtfScore ?? components.mtfScore?.score,
    aligned: raw?.confluence?.aligned ?? components.alignment?.score,
    higherTfSupport:
      raw?.confluence?.higherTimeframeConfirmation ??
      components.higherTFConfirmation?.score === 1,
    levels: pa.levels,
    atr: pa.atr as PriceActionResponse['atr'],
    adx: pa.adx as PriceActionResponse['adx'],
    momentum: pa.momentum as PriceActionResponse['momentum'],
    structureElements: pa.structureElements,
    candlestick: raw?.candlestick,
    confluenceContext: raw?.confluenceContext,
    confluenceSummary: raw?.confluence?.summary,
    signal: pa.overallSignal,
    momentumDecay: raw?.momentumDecay ?? decision.momentumDecay ?? undefined,
  });
}

function extractVetoBreakup(
  decision: Awaited<ReturnType<typeof fetchTradeDecision>>,
  vetoMode: VetoMode,
  flowMode: FlowMode = 'blend',
): DeckVetoBreakupItem[] {
  const rawDecay = decision._debug?.rawPrice?.momentumDecay;
  const alignmentField = decision.confluenceAndDecision.find(
    (row) => row.field === 'alignment',
  );
  const conflictField = decision.confluenceAndDecision.find(
    (row) => row.field === 'conflictLevel',
  );

  const momentumDecay = decision.momentumDecay ?? rawDecay;

  return buildDeckVetoBreakup({
    vetoMode,
    flowMode,
    action: decision.action,
    conviction: decision.conviction,
    priceConviction: decision.priceConviction ?? 0,
    priceConvictionBeforeDecay: decision.priceConvictionBeforeDecay,
    optionConviction: decision.optionConviction ?? 0,
    enterThreshold: decision.convictionThresholds?.enter ?? 60,
    conflictLevel: String(conflictField?.value ?? 'NONE'),
    alignment: Number(alignmentField?.value ?? 0),
    paSignal: decision.priceAction.overallSignal,
    momentumDecay: momentumDecay
      ? {
          decayPercent: momentumDecay.decayPercent,
          reasons: momentumDecay.reasons ?? [],
        }
      : undefined,
    vetoedByDecay:
      rawDecay?.vetoedByDecay ?? decision._debug?.rawPrice?.signal?.vetoedByDecay,
    minConfidenceAfterDecay: rawDecay?.minConfidenceRequired,
  });
}

function extractComponentGauges(decision: Awaited<ReturnType<typeof fetchTradeDecision>>): {
  optionComponents: DeckComponentGauge[];
  priceActionComponents: DeckComponentGauge[];
} {
  const primaryTf = primaryTimeframeForStyle(
    decision.tradingStyle as TradingStyle,
  );
  const pa = decision.priceAction.components;
  return {
    optionComponents: buildOptionComponentGauges(
      decision.optionFlow?.components ?? [],
    ),
    priceActionComponents: buildPriceActionComponentGauges(pa, {
      primaryTimeframe: primaryTf,
      timeframeScores: {
        '5m': pa['5m']?.score ?? 0,
        '15m': pa['15m']?.score ?? 0,
        '1h': pa['1h']?.score ?? 0,
      },
    }),
  };
}

function extractConvictions(decision: {
  priceConviction?: number;
  optionConviction?: number;
  confluenceAndDecision: Array<{ field: string; value: number | string }>;
}): { price: number; option: number } {
  const confluence = decision.confluenceAndDecision;
  const price =
    decision.priceConviction ??
    Number(confluence.find((c) => c.field === 'priceActionConviction')?.value ?? 0);
  const option =
    decision.optionConviction ??
    Number(confluence.find((c) => c.field === 'optionFlowConviction')?.value ?? 0);
  return { price, option };
}

async function fetchTimeline(
  fastify: FastifyInstance,
  symbol: string,
  tradingStyle: TradingStyle,
  opts?: { sessionOnly?: boolean; to?: string },
) {
  const query = new URLSearchParams({
    symbol,
    tradingStyle,
    days: '1',
    sessionOnly: String(opts?.sessionOnly ?? true),
  });
  if (opts?.to) query.set('to', opts.to);

  const res = await fastify.inject({
    method: 'GET',
    url: `/api/technical-analysis/timeline?${query.toString()}`,
  });
  if (res.statusCode !== 200) {
    return null;
  }
  return JSON.parse(res.body) as { points: TimelinePoint[] };
}

function timelineToSpotSeries(points: TimelinePoint[]): DeckSpotPoint[] {
  return points.map((p) => ({ t: p.asOf, v: p.spot }));
}

function spotSeriesToSyntheticCandles(
  points: DeckSpotPoint[],
): DeckCandlePoint[] {
  return points.map((p) => ({
    t: p.t,
    o: p.v,
    h: p.v,
    l: p.v,
    c: p.v,
  }));
}

function candleResolutionForStyle(_style: TradingStyle): string {
  return '5';
}

async function fetchSpotCandles(
  fastify: FastifyInstance,
  symbol: string,
  tradingStyle: TradingStyle,
  toMs: number,
): Promise<DeckCandlePoint[]> {
  try {
    const resolution = candleResolutionForStyle(tradingStyle);
    const session = buildIstChartSession(toMs);
    const fromMs =
      tradingStyle === TradingStyle.Intraday || tradingStyle === TradingStyle.Scalper
        ? session.fromMs - 15 * 60 * 1000
        : toMs - 24 * 60 * 60 * 1000;
    const res = await fastify.fyers.getHistory({
      symbol,
      resolution,
      range_from: Math.floor(fromMs / 1000).toString(),
      range_to: Math.floor(toMs / 1000).toString(),
      cont_flag: 1,
      oi_flag: 0,
      date_format: 0,
    });
    if (res.s !== ResponseStatus.ok || !res.candles?.length) return [];
    return res.candles.map(([t, o, h, l, c]) => ({
      t: t * 1000,
      o,
      h,
      l,
      c,
    }));
  } catch {
    return [];
  }
}

async function resolveSpotCandles(
  fastify: FastifyInstance,
  symbol: string,
  tradingStyle: TradingStyle,
  spotSeries: DeckSpotPoint[],
  toMs: number,
): Promise<DeckCandlePoint[]> {
  const candles = await fetchSpotCandles(fastify, symbol, tradingStyle, toMs);
  const resolved = candles.length
    ? candles
    : spotSeriesToSyntheticCandles(spotSeries);
  if (
    tradingStyle === TradingStyle.Intraday ||
    tradingStyle === TradingStyle.Scalper
  ) {
    return filterCandlesToIstSession(resolved, buildIstChartSession(toMs));
  }
  return resolved;
}

function computeWhatIfFromGauges(
  decision: Awaited<ReturnType<typeof fetchTradeDecision>>,
  gauges: ReturnType<typeof buildDeckGauges>,
): { action: string; conviction: number } {
  const paValue = gauges.priceAction.value;
  let action =
    decision.priceAction.overallSignal.structuralAction ?? decision.action;
  if (action === 'NO-TRADE' && Math.abs(paValue) >= 0.1) {
    action = paValue > 0 ? 'CE-BUY' : 'PE-BUY';
  }
  if (action === 'NO-TRADE') {
    return { action: 'NO-TRADE', conviction: 0 };
  }
  const conviction = Math.round(
    Math.min(90, Math.max(20, Math.abs(paValue) * 100)),
  );
  return { action, conviction };
}

function liveChartVetoed(
  decision: Awaited<ReturnType<typeof fetchTradeDecision>>,
  vetoMode: VetoMode,
): boolean {
  return (
    !isVetoOff(vetoMode) &&
    (decision.priceAction.overallSignal.confidence === 0 ||
      (decision.action === 'NO-TRADE' &&
        decision.priceAction.overallSignal.action !== 'NO-TRADE'))
  );
}

function buildReplayPointFromLiveDecision(
  base: DeckReplayPoint,
  decision: Awaited<ReturnType<typeof fetchTradeDecision>>,
  gauges: ReturnType<typeof buildDeckGauges>,
  vetoMode: VetoMode,
  liveSpot?: number,
): DeckReplayPoint {
  const components = extractComponentGauges(decision);
  const whatIf = computeWhatIfFromGauges(decision, gauges);

  return {
    ...base,
    spot: liveSpot ?? base.spot,
    optionNeedle: gauges.option.value,
    paNeedle: gauges.priceAction.value,
    optionPercent: gauges.option.percent,
    paPercent: gauges.priceAction.percent,
    paGhost: gauges.priceAction.ghost,
    conviction: decision.conviction,
    action: decision.action,
    vetoed: liveChartVetoed(decision, vetoMode),
    vetoReason: decision.priceAction.overallSignal.vetoReason,
    structuralAction: decision.priceAction.overallSignal.structuralAction,
    whatIfAction: whatIf.action,
    whatIfConviction: whatIf.conviction,
    paComponents: components.priceActionComponents,
    paDrilldown: extractPaDrilldown(decision),
    optionComponents: components.optionComponents,
    vetoBreakup: extractVetoBreakup(decision, vetoMode),
    liveSynced: true,
  };
}

function syncLastReplayPointToLive(
  replayPoints: DeckReplayPoint[],
  decision: Awaited<ReturnType<typeof fetchTradeDecision>>,
  gauges: ReturnType<typeof buildDeckGauges>,
  vetoMode: VetoMode,
  liveSpot?: number,
): DeckReplayPoint[] {
  if (!replayPoints.length) return replayPoints;
  const last = replayPoints.length - 1;
  return [
    ...replayPoints.slice(0, last),
    buildReplayPointFromLiveDecision(
      replayPoints[last],
      decision,
      gauges,
      vetoMode,
      liveSpot,
    ),
  ];
}

function computeWhatIfSignal(
  p: TimelinePoint,
  primaryTf: '5m' | '15m' | '1h',
): { action: string; conviction: number } {
  const primaryScore = p.timeframeScores[primaryTf] ?? p.mtfScore ?? 0;
  if (
    p.signal.action !== 'NO-TRADE' &&
    p.signal.confidence > 0 &&
    !p.signal.vetoReason
  ) {
    return { action: p.signal.action, conviction: p.signal.confidence };
  }

  let action = p.signal.structuralAction ?? 'NO-TRADE';
  if (action === 'NO-TRADE' && Math.abs(primaryScore) >= 0.1) {
    action = primaryScore > 0 ? 'CE-BUY' : 'PE-BUY';
  }
  if (action === 'NO-TRADE') {
    return { action: 'NO-TRADE', conviction: 0 };
  }

  const conviction = Math.round(
    Math.min(90, Math.max(20, Math.abs(primaryScore) * 100)),
  );
  return { action, conviction };
}

function timelineToVetoSeries(points: TimelinePoint[]): DeckVetoPoint[] {
  return points.map((p) => ({
    t: p.asOf,
    vetoed: Boolean(
      p.signal.vetoReason ||
        (p.signal.action === 'NO-TRADE' &&
          p.signal.structuralAction &&
          p.signal.structuralAction !== 'NO-TRADE'),
    ),
    action: p.signal.action,
    structuralAction: p.signal.structuralAction,
    vetoReason: p.signal.vetoReason,
  }));
}

function optionNeedleFromSnapshot(
  overallScore: number | undefined,
  fallback: number,
): number {
  if (
    overallScore != null &&
    Number.isFinite(overallScore) &&
    Math.abs(overallScore) >= 2
  ) {
    return Math.max(-1, Math.min(1, overallScore / 100));
  }
  return fallback;
}

function timelineToConvictionSeries(
  points: TimelinePoint[],
  style: TradingStyle,
  optionSnapshots: Awaited<
    ReturnType<typeof loadOptionChainSnapshotsForSession>
  > = [],
  vetoMode: VetoMode = 'strict',
): DeckReplayPayload['replayPoints'] {
  const primaryTf = primaryTimeframeForStyle(style);
  return points.map((p) => {
    const primaryScore = p.timeframeScores[primaryTf] ?? p.mtfScore ?? 0;
    const action = p.signal.action;
    const nearestSnapshot = nearestOptionChainSnapshot(optionSnapshots, p.asOf);
    const optionNeedle = optionNeedleFromSnapshot(
      nearestSnapshot?.overallScore,
      computeReplayOptionNeedle(p, primaryTf),
    );
    const whatIf = computeWhatIfSignal(p, primaryTf);
    const optionComponents = nearestSnapshot
      ? buildOptionComponentGauges(nearestSnapshot.components)
      : undefined;
    return {
      t: p.asOf,
      spot: p.spot,
      optionNeedle,
      paNeedle: Math.max(-1, Math.min(1, primaryScore)),
      conviction: p.signal.confidence,
      action,
      vetoed: Boolean(p.signal.vetoReason),
      vetoReason: p.signal.vetoReason,
      structuralAction: p.signal.structuralAction,
      whatIfAction: whatIf.action,
      whatIfConviction: whatIf.conviction,
      paComponents: buildReplayPaComponents(
        p.timeframeScores,
        p.mtfScore,
        p.aligned,
        primaryTf,
      ),
      paDrilldown: buildPaDrilldownFromTimelinePoint(p),
      optionComponents,
      vetoBreakup: buildReplayVetoBreakup({
        vetoMode,
        action: p.signal.action,
        conviction: p.signal.confidence,
        vetoed: Boolean(p.signal.vetoReason),
        vetoReason: p.signal.vetoReason,
        structuralAction: p.signal.structuralAction,
      }),
    };
  });
}

function timelineMarkers(points: TimelinePoint[]): DeckMarker[] {
  const markers: DeckMarker[] = [];
  let prev: string | null = null;
  for (const p of points) {
    const action = p.signal.action;
    if (prev != null && prev !== action) {
      markers.push({
        t: p.asOf,
        type: 'flip',
        label: `${prev} → ${action}`,
        action,
      });
    }
    prev = action;
  }
  return markers;
}

function buildDeckEvents(
  markers: DeckMarker[],
  vetoTimeline: DeckVetoPoint[],
  trades: DeckTradeMarker[] = [],
): DeckEvent[] {
  const events: DeckEvent[] = markers.map((m) => ({
    t: m.t,
    type: m.type === 'trade' ? 'trade' : m.type === 'flip' ? 'flip' : 'signal',
    label: m.label,
    action: m.action,
  }));

  let prevVetoed = false;
  for (const point of vetoTimeline) {
    if (point.vetoed && !prevVetoed) {
      events.push({
        t: point.t,
        type: 'veto',
        label: 'Chart veto',
        detail: point.vetoReason,
        action: point.structuralAction || point.action,
      });
    } else if (!point.vetoed && prevVetoed) {
      events.push({
        t: point.t,
        type: 'veto_clear',
        label: 'Veto cleared',
        action: point.action,
      });
    }
    prevVetoed = point.vetoed;
  }

  for (const trade of trades) {
    const sign = trade.pnlInr >= 0 ? '+' : '';
    events.push({
      t: trade.t,
      type: 'trade',
      label: trade.label,
      detail: `${sign}₹${Math.round(trade.pnlInr)} · ${trade.verdict}`,
      action: trade.verdict,
    });
  }

  return events.sort((a, b) => b.t - a.t);
}

export async function buildDeckLivePayload(
  fastify: FastifyInstance,
  params: { symbol: string; tradingStyle?: string },
): Promise<DeckLivePayload> {
  const style = parseTradingStyle(params.tradingStyle);
  const vetoState = await loadVetoPreference(fastify, { vetoMode: 'strict' });
  const flowState = await loadFlowPreference(fastify, { flowMode: 'blend' });
  const decision = await fetchTradeDecision(
    fastify,
    params.symbol,
    style,
    vetoState.vetoMode,
    flowState.flowMode,
  );
  const { price, option } = extractConvictions(decision);
  const primaryTf = primaryTimeframeForStyle(style);
  const primaryScore =
    decision.priceAction.components[primaryTf]?.score ?? 0;

  const gauges = buildDeckGauges({
    action: decision.action as 'CE-BUY' | 'PE-BUY' | 'NO-TRADE' | 'NEUTRAL',
    optionConviction: option,
    optionBias: decision.optionFlow.bias,
    optionOverallScore: decision.optionFlow.overallScore,
    priceConviction: price,
    priceConvictionBeforeDecay: decision.priceConvictionBeforeDecay,
    primaryScore,
    hasMomentumDecay: Boolean(decision.momentumDecay?.decayPercent),
  });

  const timeline = await fetchTimeline(fastify, params.symbol, style);
  const points = timeline?.points ?? [];
  const recent = points.slice(-48);

  const marketOpen = isIndianMarketOpen(Date.now());
  const indexSymbol = decision.symbol || params.symbol;
  const liveLastPrice = resolveLiveIndexPrice(
    fastify,
    indexSymbol,
    decision.lastPrice,
  );
  const streamSpotSeries =
    fastify.fyersMarketStream?.getSpotSeries(indexSymbol) ?? [];
  const spotSeries = mergeSpotSeriesWithStream(
    timelineToSpotSeries(recent),
    streamSpotSeries,
  );

  const chartVetoed = liveChartVetoed(decision, vetoState.vetoMode);

  return {
    mode: 'live',
    symbol: decision.symbol || params.symbol,
    symbolLabel: shortSymbol(decision.symbol || params.symbol),
    tradingStyle: String(style),
    asOf: new Date().toISOString(),
    marketOpen,
    action: decision.action,
    bias: decision.bias,
    conviction: decision.conviction,
    entryThreshold: resolveEntryThreshold(decision, style),
    lastPrice: liveLastPrice,
    chartVetoed,
    vetoMode: vetoState.vetoMode,
    vetoOff: isVetoOff(vetoState.vetoMode),
    flowMode: flowState.flowMode,
    gauges,
    lanes: {
      optionPercent: option,
      priceActionPercent: price,
      combinedPercent: decision.conviction,
    },
    spotSeries,
    spotCandles: await resolveSpotCandles(
      fastify,
      indexSymbol,
      style,
      spotSeries,
      Date.now(),
    ),
    convictionSeries: recent.map((p) => ({
      t: p.asOf,
      option:
        p.signal.action === 'CE-BUY'
          ? p.signal.confidence
          : p.signal.action === 'PE-BUY'
            ? p.signal.confidence
            : 0,
      priceAction: Math.round(Math.abs(p.mtfScore) * 100),
      combined: p.signal.confidence,
    })),
    markers: timelineMarkers(recent),
    events: prependPatternFormingEvent(
      buildDeckEvents(
        timelineMarkers(recent),
        timelineToVetoSeries(recent),
      ),
      extractPatternContext(decision, spotSeries),
    ),
    vetoTimeline: timelineToVetoSeries(recent),
    vetoReason: decision.priceAction.overallSignal.vetoReason,
    structuralAction: decision.priceAction.overallSignal.structuralAction,
    vetoBreakup: extractVetoBreakup(
      decision,
      vetoState.vetoMode,
      flowState.flowMode,
    ),
    ...extractComponentGauges(decision),
    paDrilldown: extractPaDrilldown(decision),
    strategyRecommendation: extractDeckStrategyPayload(decision),
    patternContext: extractPatternContext(decision, spotSeries),
  };
}

export async function buildDeckLiveStreamTick(
  fastify: FastifyInstance,
  params: { symbol: string; tradingStyle?: string },
): Promise<DeckLiveStreamTick> {
  const style = parseTradingStyle(params.tradingStyle);
  const vetoState = await loadVetoPreference(fastify, { vetoMode: 'strict' });
  const flowState = await loadFlowPreference(fastify, { flowMode: 'blend' });
  const decision = await fetchTradeDecision(
    fastify,
    params.symbol,
    style,
    vetoState.vetoMode,
    flowState.flowMode,
  );
  const { price, option } = extractConvictions(decision);
  const primaryTf = primaryTimeframeForStyle(style);
  const primaryScore =
    decision.priceAction.components[primaryTf]?.score ?? 0;

  const gauges = buildDeckGauges({
    action: decision.action as 'CE-BUY' | 'PE-BUY' | 'NO-TRADE' | 'NEUTRAL',
    optionConviction: option,
    optionBias: decision.optionFlow.bias,
    optionOverallScore: decision.optionFlow.overallScore,
    priceConviction: price,
    priceConvictionBeforeDecay: decision.priceConvictionBeforeDecay,
    primaryScore,
    hasMomentumDecay: Boolean(decision.momentumDecay?.decayPercent),
  });

  const marketOpen = isIndianMarketOpen(Date.now());
  const indexSymbol = decision.symbol || params.symbol;
  const liveLastPrice = resolveLiveIndexPrice(
    fastify,
    indexSymbol,
    decision.lastPrice,
  );
  const spotSeries =
    fastify.fyersMarketStream?.getSpotSeries(indexSymbol) ?? [];

  const chartVetoed = liveChartVetoed(decision, vetoState.vetoMode);

  return {
    type: 'tick',
    asOf: new Date().toISOString(),
    marketOpen,
    action: decision.action,
    bias: decision.bias,
    conviction: decision.conviction,
    entryThreshold: resolveEntryThreshold(decision, style),
    lastPrice: liveLastPrice,
    chartVetoed,
    gauges,
    lanes: {
      optionPercent: option,
      priceActionPercent: price,
      combinedPercent: decision.conviction,
    },
    spotSeries,
    ...extractComponentGauges(decision),
    paDrilldown: extractPaDrilldown(decision),
    flowMode: flowState.flowMode,
    vetoBreakup: extractVetoBreakup(
      decision,
      vetoState.vetoMode,
      flowState.flowMode,
    ),
    vetoReason: decision.priceAction.overallSignal.vetoReason,
    structuralAction: decision.priceAction.overallSignal.structuralAction,
    patternContext: extractPatternContext(decision, spotSeries),
  };
}

export async function buildDeckReplayPayload(
  fastify: FastifyInstance,
  params: { symbol: string; tradingStyle?: string; sessionDate?: string },
): Promise<DeckReplayPayload> {
  const style = parseTradingStyle(params.tradingStyle);
  const { sessionDate } = getIstSessionClock(
    Date.now(),
    'Asia/Kolkata',
  );
  const date = params.sessionDate ?? sessionDate;

  const vetoState = await loadVetoPreference(fastify, { vetoMode: 'strict' });
  const flowState = await loadFlowPreference(fastify, { flowMode: 'blend' });
  const decision = await fetchTradeDecision(
    fastify,
    params.symbol,
    style,
    vetoState.vetoMode,
    flowState.flowMode,
  );
  const { price, option } = extractConvictions(decision);
  const primaryTf = primaryTimeframeForStyle(style);
  const primaryScore =
    decision.priceAction.components[primaryTf]?.score ?? 0;

  const gauges = buildDeckGauges({
    action: decision.action as 'CE-BUY' | 'PE-BUY' | 'NO-TRADE' | 'NEUTRAL',
    optionConviction: option,
    optionBias: decision.optionFlow.bias,
    optionOverallScore: decision.optionFlow.overallScore,
    priceConviction: price,
    priceConvictionBeforeDecay: decision.priceConvictionBeforeDecay,
    primaryScore,
    hasMomentumDecay: Boolean(decision.momentumDecay?.decayPercent),
  });

  const timeline = await fetchTimeline(fastify, params.symbol, style, {
    sessionOnly: true,
    to: `${date}T15:30:00+05:30`,
  });
  const points = timeline?.points ?? [];
  const optionSnapshots = await loadOptionChainSnapshotsForSession(
    fastify,
    params.symbol,
    style,
    date,
  );
  let replayPoints = timelineToConvictionSeries(
    points,
    style,
    optionSnapshots,
    vetoState.vetoMode,
  );
  const isCurrentSession = date === sessionDate;
  if (isCurrentSession && replayPoints.length > 0) {
    const indexSymbol = decision.symbol || params.symbol;
    const liveSpot = resolveLiveIndexPrice(
      fastify,
      indexSymbol,
      decision.lastPrice,
    );
    replayPoints = syncLastReplayPointToLive(
      replayPoints,
      decision,
      gauges,
      vetoState.vetoMode,
      liveSpot,
    );
  }
  const hasHistoricalOptions = optionSnapshots.length > 0;

  const trades: DeckTradeMarker[] = [];
  try {
    const coachRes = await fastify.inject({
      method: 'GET',
      url: `/api/trading-coach?symbol=${encodeURIComponent(params.symbol)}&tradingStyle=${style}&date=${date}`,
    });
    if (coachRes.statusCode === 200) {
      const coach = JSON.parse(coachRes.body) as {
        trades: Array<{
          trade: {
            entryAtMs: number;
            optionSymbol: string;
            pnlInr: number;
          };
          analysis: { verdict: string };
        }>;
      };
      let cumPnl = 0;
      for (const report of coach.trades) {
        cumPnl += report.trade.pnlInr;
        const label = report.trade.optionSymbol.split(':').pop() ?? 'trade';
        trades.push({
          t: report.trade.entryAtMs,
          symbol: label,
          pnlInr: report.trade.pnlInr,
          verdict: report.analysis.verdict,
          label,
        });
      }
    }
  } catch {
    // Coach data is optional for replay UI.
  }

  const pnlSeries: Array<{ t: number; v: number }> = [];
  let running = 0;
  for (const trade of [...trades].sort((a, b) => a.t - b.t)) {
    running += trade.pnlInr;
    pnlSeries.push({ t: trade.t, v: running });
  }

  return {
    mode: 'replay',
    symbol: decision.symbol || params.symbol,
    symbolLabel: shortSymbol(decision.symbol || params.symbol),
    tradingStyle: String(style),
    sessionDate: date,
    entryThreshold: resolveEntryThreshold(decision, style),
    gauges,
    replayPoints,
    spotSeries: timelineToSpotSeries(points),
    spotCandles: await resolveSpotCandles(
      fastify,
      decision.symbol || params.symbol,
      style,
      timelineToSpotSeries(points),
      Date.parse(`${date}T15:30:00+05:30`),
    ),
    pnlSeries,
    trades,
    markers: timelineMarkers(points),
    events: buildDeckEvents(
      timelineMarkers(points),
      timelineToVetoSeries(points),
      trades,
    ),
    optionComponents: hasHistoricalOptions
      ? replayPoints[replayPoints.length - 1]?.optionComponents ??
        extractComponentGauges(decision).optionComponents
      : extractComponentGauges(decision).optionComponents,
    optionComponentsNote: hasHistoricalOptions
      ? 'Option chain breakdown from stored 5–15m snapshots · scrub updates both lanes'
      : 'Option chain breakdown is a live read until snapshots accumulate · scrub updates price-action components per minute',
    vetoTimeline: timelineToVetoSeries(points),
    vetoMode: vetoState.vetoMode,
    flowMode: flowState.flowMode,
    vetoBreakup: extractVetoBreakup(
      decision,
      vetoState.vetoMode,
      flowState.flowMode,
    ),
    strategyRecommendation: extractDeckStrategyPayload(decision, {
      replayNote:
        'Strategy read uses the engine snapshot for this style (not scrubbed per replay minute).',
    }),
    pnlNote:
      trades.length === 0
        ? 'Fills session PnL when /coach finds closed option trades for this date (Fyers tradebook).'
        : undefined,
  };
}