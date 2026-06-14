import { FastifyInstance } from 'fastify';
import { ResponseStatus } from '../types/common';
import { getStyleScoringConfig } from '../trading-style';
import { TradingStyle } from '../types/trading-style';
import {
  PriceActionResponse,
} from '../types/technical-analysis';
import {
  DeckComponentGauge,
} from './deck-components';
import {
  DeckVetoBreakupItem,
} from './deck-veto-breakup';
import {
  PaDrilldown,
} from './deck-pa-drilldown';
import {
  buildDeckPatternContext,
  buildIstChartSession,
  DeckPatternContext,
  DeckChartSession,
} from './deck-pattern-context';
import {
  DeckStrategyPayload,
  extractDeckStrategyPayload,
} from './deck-strategy';
import { buildDeckGauges } from './deck-gauge';
import {
  loadOptionChainSnapshotsForSession,
} from './option-chain-snapshot-store';
import {
  timelineToSpotSeries,
  timelineToVetoSeries,
  timelineMarkers,
  spotSeriesToSyntheticCandles,
  extractComponentGauges,
  buildDeckEvents,
  extractPaDrilldown,
  extractVetoBreakup,
  syncLastReplayPointToLive,
  timelineToConvictionSeries,
} from './deck-replay-utils';
import { getOrBuildDeckReplayPayload } from './deck-replay-cache';
import { getIstSessionClock, isIndianMarketOpen } from './signal-tracker';
import { VetoMode } from './veto-preference';
import { FlowMode } from '../types/flow-mode';
import { DECK_LIVE_TIMELINE } from '../constants/technical-analysis';
import { ConvictionBonus } from '../types/trade-decision';
import {
  toManagementDecisionPayload,
  toManagementPriceData,
} from './management-decision-mapper';
import { fetchTradeDecisionAlert } from './trade-decision-fetch';
import { isVetoOff } from '../types/veto-mode';
import {
  buildDeckOpenPositions,
  DeckOpenPositionsPayload,
} from './deck-open-positions';
import { computeManagementAdvice, getOpenPositionContext, PositionManagementContext } from './position-monitor';
import {
  DeckMarketRegime,
  resolveDeckMarketRegime,
} from './market-regime';

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

/**
 * Merges timeline spot series with live stream series based on timestamp.
 * 
 * @param {DeckSpotPoint[]} timelineSeries - The historical timeline spot series.
 * @param {DeckSpotPoint[]} streamSeries - The live stream spot series.
 * @returns {DeckSpotPoint[]} Merged spot series.
 */
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
  weightedBaseConviction?: number;
  convictionBonuses?: ConvictionBonus[];
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
  tradeSetup?: {
    entry: number;
    stopLoss: number;
    takeProfits?: Array<{ multiplier: number; price: number }>;
  };
  levels?: { support?: number; resistance?: number };
  confluenceContext?: Record<string, unknown>;
  candlestick?: Record<string, string>;
  primaryTimeframe?: string;
  patternInsights?: DeckPatternInsight[];
  tradeOutcome?: { exitPrice?: number; status?: string };
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

export interface DeckPatternInsight {
  timeframe: string;
  pattern: string;
  status: string;
  tone: 'bull' | 'bear' | 'neutral';
  label: string;
  type: 'chart' | 'candlestick';
}

export interface DeckLiveStreamTick {
  type: 'tick';
  asOf: string;
  marketOpen: boolean;
  action: string;
  bias: string;
  conviction: number;
  weightedBaseConviction: number;
  convictionBonuses: ConvictionBonus[];
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
  patternInsights: DeckPatternInsight[];
  marketRegime: DeckMarketRegime;
  managementContext?: PositionManagementContext;
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
  weightedBaseConviction: number;
  convictionBonuses: ConvictionBonus[];
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
  spotCandles5m: DeckCandlePoint[];
  spotCandles15m: DeckCandlePoint[];
  spotCandles1h: DeckCandlePoint[];
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
  patternInsights: DeckPatternInsight[];
  chartSessionLabel?: string;
  openPositions: DeckOpenPositionsPayload;
  marketRegime: DeckMarketRegime;
  managementContext?: PositionManagementContext;
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
  spotCandles5m: DeckCandlePoint[];
  spotCandles15m: DeckCandlePoint[];
  spotCandles1h: DeckCandlePoint[];
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
  patternInsights: DeckPatternInsight[];
  patternContext?: DeckPatternContext;
  chartSessionLabel?: string;
  pnlNote?: string;
  managementContext?: PositionManagementContext;
  openPositions?: DeckOpenPositionsPayload;
}

type DeckTradeDecision = {
    symbol: string;
    lastPrice: number;
    tradingStyle: string;
    action: string;
    bias: string;
    conviction: number;
    weightedBaseConviction?: number;
    convictionBonuses?: ConvictionBonus[];
    priceConviction?: number;
    priceConvictionBeforeDecay?: number;
    optionConviction?: number;
    momentumDecay?: { decayPercent: number; reasons?: string[] };
    flowMode?: FlowMode;
    vetoMode?: VetoMode;
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
      rawPrice?: PriceActionResponse;
      rawOption?: unknown;
    };
};

function resolveManagementPriceData(decision: DeckTradeDecision): PriceActionResponse {
  const rawPrice = decision._debug?.rawPrice;
  if (rawPrice) {
    return toManagementPriceData({
      ...rawPrice,
      lastPrice: decision.lastPrice,
    });
  }
  return {
    lastPrice: decision.lastPrice,
    momentumDecay: decision.momentumDecay,
  } as PriceActionResponse;
}

// Helpers missing after refactor — provide lightweight implementations used by deck UI
function filterCandlesToIstSession(candles: DeckCandlePoint[], session: DeckChartSession): DeckCandlePoint[] {
  return (candles || []).filter((c) => c.t >= session.fromMs && c.t <= session.toMs);
}

function extractConvictions(decision: DeckTradeDecision) {
  return {
    price: decision.priceConviction ?? 0,
    option: decision.optionConviction ?? 0,
  };
}

function liveChartVetoed(decision: DeckTradeDecision, _vetoMode: VetoMode): boolean {
  return Boolean(decision.priceAction?.overallSignal?.vetoReason);
}

function buildDeckLaneMeta(decision: DeckTradeDecision, gauges: any) {
  const optionPercent = gauges?.option?.percent ?? 0;
  const priceActionPercent = gauges?.priceAction?.percent ?? 0;
  const combinedPercent = Math.round((optionPercent + priceActionPercent) / 2);
  return {
    lanes: {
      optionPercent,
      priceActionPercent,
      combinedPercent,
    },
    weightedBaseConviction: decision.weightedBaseConviction ?? Math.round(decision.conviction ?? 0),
    convictionBonuses: decision.convictionBonuses ?? [],
  };
}

function prependPatternEvents(events: DeckEvent[], ctx?: DeckPatternContext): DeckEvent[] {
  if (!ctx || !ctx.markers || !ctx.markers.length) return events;
  const patternEvents = ctx.markers.map((m) => ({ t: m.t, type: 'flip' as any, label: m.label }));
  return [...patternEvents, ...events];
}

function extractPatternContext(decision: DeckTradeDecision, spotSeriesTail: Array<{ t: number }>): DeckPatternContext | undefined {
  const raw = decision._debug?.rawPrice ?? undefined;
  try {
    const price = raw ?? resolveManagementPriceData(decision);
    return buildDeckPatternContext(price, spotSeriesTail as any);
  } catch {
    return undefined;
  }
}

async function extractStrategyRecommendation(
  _fastify: FastifyInstance,
  decision: DeckTradeDecision,
  _style: TradingStyle,
  opts?: { replayNote?: string; replayMode?: boolean; marketRegime?: any },
): Promise<DeckStrategyPayload> {
  // For now reuse deck-strategy extractor — more advanced logic may use fastify for quotes
  return extractDeckStrategyPayload(decision as any, { replayNote: opts?.replayNote });
}

function extractMarketRegime(decision: DeckTradeDecision, style: TradingStyle, _opts?: { flowMode?: FlowMode; vetoMode?: VetoMode }) {
  try {
    return resolveDeckMarketRegime({
      symbol: decision.symbol,
      tradingStyle: style,
      mtfScore: (decision.priceAction as any)?.mtfScore,
      aligned: (decision.priceAction as any)?.confluence?.aligned,
      confluenceContext: (decision.priceAction as any)?.confluence,
    });
  } catch {
    return resolveDeckMarketRegime({ symbol: decision.symbol, tradingStyle: style });
  }
}

async function fetchDeckTradeDecision(
  fastify: FastifyInstance,
  symbol: string,
  tradingStyle: TradingStyle,
  vetoMode: VetoMode = 'strict',
  flowMode: FlowMode = 'blend',
  options?: { sessionVerified?: boolean },
): Promise<DeckTradeDecision> {
  const payload = await fetchTradeDecisionAlert(fastify, symbol, tradingStyle, {
    vetoMode,
    flowMode,
    skipPositionSizing: true,
    skipAdaptiveConviction: true,
    sessionVerified: options?.sessionVerified,
  });
  if (!payload?._decisionBody) {
    throw new Error('Trade decision response missing body');
  }
  const body = payload._decisionBody;
  return body as DeckTradeDecision;
}

function resolveDeckPreferences(fastify: FastifyInstance): {
  vetoMode: VetoMode;
  flowMode: FlowMode;
} {
  return {
    vetoMode: fastify.telegramNotifications?.getVetoMode?.() ?? 'strict',
    flowMode: fastify.telegramNotifications?.getFlowMode?.() ?? 'blend',
  };
}

type TimelineResponse = {
  points?: Array<Record<string, unknown>>;
  spotCandles?: {
    '5m': DeckCandlePoint[];
    '15m': DeckCandlePoint[];
    '1h': DeckCandlePoint[];
  };
};

function multiCandlesFromTimeline(
  timeline: TimelineResponse | null,
  toMs: number,
): {
  c5: DeckCandlePoint[];
  c15: DeckCandlePoint[];
  c1h: DeckCandlePoint[];
  historical?: boolean;
} {
  const session = buildIstChartSession(toMs);
  const raw = timeline?.spotCandles;
  if (raw) {
    const filtered = {
      c5: filterCandlesToIstSession(raw['5m'] ?? [], session),
      c15: filterCandlesToIstSession(raw['15m'] ?? [], session),
      c1h: filterCandlesToIstSession(raw['1h'] ?? [], session),
    };
    const hasSession =
      filtered.c5.length > 0 ||
      filtered.c15.length > 0 ||
      filtered.c1h.length > 0;
    if (hasSession) return filtered;

    const hist5 = raw['5m'] ?? [];
    const hist15 = raw['15m'] ?? [];
    const hist1h = raw['1h'] ?? [];
    if (hist5.length || hist15.length || hist1h.length) {
      return {
        c5: hist5,
        c15: hist15,
        c1h: hist1h,
        historical: true,
      };
    }
    return filtered;
  }
  return { c5: [], c15: [], c1h: [] };
}

async function buildDeckManagementContext(
  fastify: FastifyInstance,
  decision: DeckTradeDecision,
  style: TradingStyle,
  indexSymbol: string,
): Promise<PositionManagementContext> {
  try {
    const ctx = await getOpenPositionContext(fastify, [indexSymbol]);
    const base = {
      hasOpenPosition: ctx.count > 0,
      heldDirection: ctx.heldDirection,
      isMixedDirections: ctx.isMixedDirections,
      count: ctx.count,
    };

    if (ctx.count > 0) {
      const advice = computeManagementAdvice(
        ctx,
        toManagementDecisionPayload({
          action: decision.action,
          conviction: decision.conviction,
          overallSignal: decision.priceAction.overallSignal,
        }),
        resolveManagementPriceData(decision),
        style,
      );
      return {
        hasOpenPosition: true,
        heldDirection: ctx.heldDirection,
        isMixedDirections: ctx.isMixedDirections,
        count: ctx.count,
        advice,
        note: advice.headline,
        health: advice.positionHealth,
      };
    }
    return { ...base, hasOpenPosition: false };
  } catch {
    return { hasOpenPosition: false };
  }
}

async function fetchTimeline(
  fastify: FastifyInstance,
  symbol: string,
  tradingStyle: TradingStyle,
  options?: {
    sessionOnly?: boolean;
    to?: string;
    days?: number;
    interval?: number;
    maxPoints?: number;
    includeCandles?: boolean;
  },
): Promise<TimelineResponse | null> {
  const params = new URLSearchParams();
  params.set('symbol', symbol);
  if (tradingStyle) params.set('tradingStyle', String(tradingStyle));
  if (options?.sessionOnly !== undefined) params.set('sessionOnly', String(options.sessionOnly));
  if (options?.to) params.set('to', String(options.to));
  if (options?.days !== undefined) params.set('days', String(options.days));
  if (options?.interval !== undefined) params.set('interval', String(options.interval));
  if (options?.maxPoints !== undefined) {
    params.set('maxPoints', String(options.maxPoints));
  }
  if (options?.includeCandles) params.set('includeCandles', 'true');

  try {
    const res = await fastify.inject({
      method: 'GET',
      url: `/api/technical-analysis/timeline?${params.toString()}`,
    });
    if (res.statusCode !== 200) {
      fastify.log.warn({ statusCode: res.statusCode, body: res.body }, 'fetchTimeline failed');
      return null;
    }
    return JSON.parse(res.body);
  } catch (err) {
    fastify.log.warn({ err }, 'fetchTimeline request failed');
    return null;
  }
}

function extractPatternInsights(decision: DeckTradeDecision): DeckPatternInsight[] {
  const rawPrice = decision._debug?.rawPrice as PriceActionResponse | undefined;
  if (!rawPrice) return [];

  const insights: DeckPatternInsight[] = [];

  // Chart patterns
  const chartPattern = rawPrice.confluenceContext?.chartPattern;
  if (chartPattern && chartPattern !== 'none') {
    insights.push({
      timeframe: rawPrice.primaryTimeframe || '15m',
      pattern: chartPattern.replace(/_/g, ' '),
      status: rawPrice.confluenceContext?.chartPatternStatus || 'forming',
      tone: toneForDirection(rawPrice.confluenceContext?.chartPatternDirection || 'neutral'),
      label: 'Chart Pattern',
      type: 'chart',
    });
  }

  // Candlestick patterns
  const candles = rawPrice.candlestick;
  if (candles) {
    if (candles['5m'] && candles['5m'] !== 'none') {
      insights.push({
        timeframe: '5m',
        pattern: candles['5m'].replace(/_/g, ' '),
        status: 'confirmed',
        tone: toneForCandle(candles['5m']),
        label: 'Candlestick',
        type: 'candlestick',
      });
    }
    if (candles['15m'] && candles['15m'] !== 'none') {
      insights.push({
        timeframe: '15m',
        pattern: candles['15m'].replace(/_/g, ' '),
        status: 'confirmed',
        tone: toneForCandle(candles['15m']),
        label: 'Candlestick',
        type: 'candlestick',
      });
    }
    if (candles['1h'] && candles['1h'] !== 'none') {
      insights.push({
        timeframe: '1h',
        pattern: candles['1h'].replace(/_/g, ' '),
        status: 'confirmed',
        tone: toneForCandle(candles['1h']),
        label: 'Candlestick',
        type: 'candlestick',
      });
    }
  }

  return insights;
}

function toneForDirection(dir: string): 'bull' | 'bear' | 'neutral' {
  if (dir === 'bullish') return 'bull';
  if (dir === 'bearish') return 'bear';
  return 'neutral';
}

function toneForCandle(pattern: string): 'bull' | 'bear' | 'neutral' {
  if (/bull|hammer|morning|soldiers|piercing/i.test(pattern)) return 'bull';
  if (/bear|shooting|evening|crows|dark_cloud/i.test(pattern)) return 'bear';
  return 'neutral';
}

async function resolveMultiTimeframeCandles(
  fastify: FastifyInstance,
  symbol: string,
  toMs: number,
) {
  const [c5, c15, c1h] = await Promise.all([
    fetchSpotCandlesWithResolution(fastify, symbol, '5', toMs),
    fetchSpotCandlesWithResolution(fastify, symbol, '15', toMs),
    fetchSpotCandlesWithResolution(fastify, symbol, '60', toMs),
  ]);
  const session = buildIstChartSession(toMs);
  return {
    c5: filterCandlesToIstSession(c5, session),
    c15: filterCandlesToIstSession(c15, session),
    c1h: filterCandlesToIstSession(c1h, session),
  };
}

/** Fallback when timeline omits candles (e.g. upstream error). */
async function ensureTimelineHasCandles(
  fastify: FastifyInstance,
  timeline: TimelineResponse | null,
  symbol: string,
  toMs: number,
): Promise<TimelineResponse | null> {
  if (timeline?.spotCandles?.['5m']?.length) return timeline;
  const multi = await resolveMultiTimeframeCandles(fastify, symbol, toMs);
  return {
    ...(timeline ?? {}),
    spotCandles: {
      '5m': multi.c5,
      '15m': multi.c15,
      '1h': multi.c1h,
    },
  };
}

async function fetchSpotCandlesWithResolution(
  fastify: FastifyInstance,
  symbol: string,
  resolution: string,
  toMs: number,
): Promise<DeckCandlePoint[]> {
  try {
    const session = buildIstChartSession(toMs);
    const fromMs = session.fromMs - 6 * 60 * 60 * 1000; // Extra buffer
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

function assembleLivePayloadParts(
  fastify: FastifyInstance,
  params: {
    symbol: string;
    style: TradingStyle;
    decision: DeckTradeDecision;
    timeline: TimelineResponse | null;
    vetoMode: VetoMode;
    flowMode: FlowMode;
    openPositions: DeckOpenPositionsPayload;
    managementContext: PositionManagementContext;
    strategyRecommendation: DeckStrategyPayload;
    toMs?: number;
  },
): DeckLivePayload {
  const {
    decision,
    timeline,
    style,
    vetoMode,
    flowMode,
    openPositions,
    managementContext,
    strategyRecommendation,
  } = params;
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

  const points = timeline?.points ?? [];
  const recent = points;
  const toMs = params.toMs ?? Date.now();
  const marketOpen = isIndianMarketOpen(toMs);
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

  const chartVetoed = liveChartVetoed(decision, vetoMode);
  const laneMeta = buildDeckLaneMeta(decision, gauges);
  const multiCandles = multiCandlesFromTimeline(timeline, toMs);

  return {
    mode: 'live',
    symbol: indexSymbol,
    symbolLabel: shortSymbol(indexSymbol),
    tradingStyle: String(style),
    asOf: new Date().toISOString(),
    marketOpen,
    action: decision.action,
    bias: decision.bias,
    conviction: decision.conviction,
    weightedBaseConviction: laneMeta.weightedBaseConviction,
    convictionBonuses: laneMeta.convictionBonuses,
    entryThreshold: resolveEntryThreshold(decision, style),
    lastPrice: liveLastPrice,
    chartVetoed,
    vetoMode,
    vetoOff: isVetoOff(vetoMode),
    flowMode,
    gauges,
    lanes: laneMeta.lanes,
    spotSeries,
    spotCandles: multiCandles.c5.length
      ? multiCandles.c5
      : spotSeriesToSyntheticCandles(spotSeries),
    spotCandles5m: multiCandles.c5,
    spotCandles15m: multiCandles.c15,
    spotCandles1h: multiCandles.c1h,
    convictionSeries: recent.map((p: any) => ({
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
    events: prependPatternEvents(
      buildDeckEvents(
        timelineMarkers(recent),
        timelineToVetoSeries(recent),
      ),
      extractPatternContext(decision, spotSeries),
    ),
    vetoTimeline: timelineToVetoSeries(recent),
    vetoReason: decision.priceAction.overallSignal.vetoReason,
    structuralAction: decision.priceAction.overallSignal.structuralAction,
    vetoBreakup: extractVetoBreakup(decision, vetoMode, flowMode),
    ...extractComponentGauges(decision),
    paDrilldown: extractPaDrilldown(decision),
    strategyRecommendation,
    patternContext: extractPatternContext(decision, spotSeries),
    patternInsights: extractPatternInsights(decision),
    chartSessionLabel: multiCandles.historical
      ? 'Recent history (market closed / pre-open)'
      : '09:15–15:30 IST',
    openPositions,
    marketRegime: extractMarketRegime(decision, style, {
      flowMode,
      vetoMode,
    }),
    managementContext,
  };
}

export type DeckLiveEnrichmentPayload = Pick<
  DeckLivePayload,
  | 'symbol'
  | 'symbolLabel'
  | 'tradingStyle'
  | 'vetoMode'
  | 'vetoOff'
  | 'flowMode'
  | 'chartVetoed'
  | 'spotSeries'
  | 'spotCandles'
  | 'spotCandles5m'
  | 'spotCandles15m'
  | 'spotCandles1h'
  | 'convictionSeries'
  | 'markers'
  | 'events'
  | 'vetoTimeline'
  | 'strategyRecommendation'
  | 'patternContext'
  | 'patternInsights'
  | 'openPositions'
  | 'managementContext'
  | 'marketRegime'
>;

export async function buildDeckLiveEnrichmentPayload(
  fastify: FastifyInstance,
  params: { symbol: string; tradingStyle?: string },
): Promise<DeckLiveEnrichmentPayload> {
  const sessionReady = await fastify.ensureFyersSession();
  if (!sessionReady) {
    throw new Error(
      'Fyers session expired — log in again to load live deck data.',
    );
  }

  const style = parseTradingStyle(params.tradingStyle);
  const { vetoMode, flowMode } = resolveDeckPreferences(fastify);

  const [decision, timeline] = await Promise.all([
    fetchDeckTradeDecision(
      fastify,
      params.symbol,
      style,
      vetoMode,
      flowMode,
      { sessionVerified: true },
    ),
    fetchTimeline(fastify, params.symbol, style, {
      days: DECK_LIVE_TIMELINE.DAYS,
      maxPoints: DECK_LIVE_TIMELINE.MAX_POINTS,
      includeCandles: true,
    }),
  ]);

  const indexSymbol = decision.symbol || params.symbol;
  const timelineWithCandles = await ensureTimelineHasCandles(
    fastify,
    timeline,
    indexSymbol,
    Date.now(),
  );
  const marketRegime = extractMarketRegime(decision, style, {
    flowMode,
    vetoMode,
  });

  const [openPositions, managementContext, strategyRecommendation] =
    await Promise.all([
      buildDeckOpenPositions(fastify, {
        watchedIndexSymbol: indexSymbol,
        ivRegime: decision.optionFlow?.ivRegime,
      }),
      buildDeckManagementContext(fastify, decision, style, indexSymbol),
      extractStrategyRecommendation(fastify, decision, style, {
        marketRegime,
      }),
    ]);

  const full = assembleLivePayloadParts(fastify, {
    symbol: params.symbol,
    style,
    decision,
    timeline: timelineWithCandles,
    vetoMode,
    flowMode,
    openPositions,
    managementContext,
    strategyRecommendation,
  });

  return {
    symbol: full.symbol,
    symbolLabel: full.symbolLabel,
    tradingStyle: full.tradingStyle,
    vetoMode: full.vetoMode,
    vetoOff: full.vetoOff,
    flowMode: full.flowMode,
    chartVetoed: full.chartVetoed,
    spotSeries: full.spotSeries,
    spotCandles: full.spotCandles,
    spotCandles5m: full.spotCandles5m,
    spotCandles15m: full.spotCandles15m,
    spotCandles1h: full.spotCandles1h,
    convictionSeries: full.convictionSeries,
    markers: full.markers,
    events: full.events,
    vetoTimeline: full.vetoTimeline,
    strategyRecommendation: full.strategyRecommendation,
    patternContext: full.patternContext,
    patternInsights: full.patternInsights,
    openPositions: full.openPositions,
    managementContext: full.managementContext,
    marketRegime: full.marketRegime,
  };
}

export async function buildDeckLivePayload(
  fastify: FastifyInstance,
  params: { symbol: string; tradingStyle?: string },
): Promise<DeckLivePayload> {
  const sessionReady = await fastify.ensureFyersSession();
  if (!sessionReady) {
    throw new Error(
      'Fyers session expired — log in again to load live deck data.',
    );
  }

  const style = parseTradingStyle(params.tradingStyle);
  const { vetoMode, flowMode } = resolveDeckPreferences(fastify);

  const [decision, timeline] = await Promise.all([
    fetchDeckTradeDecision(
      fastify,
      params.symbol,
      style,
      vetoMode,
      flowMode,
      { sessionVerified: true },
    ),
    fetchTimeline(fastify, params.symbol, style, {
      days: DECK_LIVE_TIMELINE.DAYS,
      maxPoints: DECK_LIVE_TIMELINE.MAX_POINTS,
      includeCandles: true,
    }),
  ]);

  const indexSymbol = decision.symbol || params.symbol;
  const timelineWithCandles = await ensureTimelineHasCandles(
    fastify,
    timeline,
    indexSymbol,
    Date.now(),
  );
  const marketRegime = extractMarketRegime(decision, style, {
    flowMode,
    vetoMode,
  });

  const [openPositions, managementContext, strategyRecommendation] =
    await Promise.all([
      buildDeckOpenPositions(fastify, {
        watchedIndexSymbol: indexSymbol,
        ivRegime: decision.optionFlow?.ivRegime,
      }),
      buildDeckManagementContext(fastify, decision, style, indexSymbol),
      extractStrategyRecommendation(fastify, decision, style, {
        marketRegime,
      }),
    ]);

  return assembleLivePayloadParts(fastify, {
    symbol: params.symbol,
    style,
    decision,
    timeline: timelineWithCandles,
    vetoMode,
    flowMode,
    openPositions,
    managementContext,
    strategyRecommendation,
  });
}

export async function buildDeckLiveStreamTick(
  fastify: FastifyInstance,
  params: { symbol: string; tradingStyle?: string },
): Promise<DeckLiveStreamTick> {
  const style = parseTradingStyle(params.tradingStyle);
  const { vetoMode, flowMode } = resolveDeckPreferences(fastify);
  const decision = await fetchDeckTradeDecision(
    fastify,
    params.symbol,
    style,
    vetoMode,
    flowMode,
    { sessionVerified: true },
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

  const chartVetoed = liveChartVetoed(decision, vetoMode);
  const laneMeta = buildDeckLaneMeta(decision, gauges);

  return {
    type: 'tick',
    asOf: new Date().toISOString(),
    marketOpen,
    action: decision.action,
    bias: decision.bias,
    conviction: decision.conviction,
    weightedBaseConviction: laneMeta.weightedBaseConviction,
    convictionBonuses: laneMeta.convictionBonuses,
    entryThreshold: resolveEntryThreshold(decision, style),
    lastPrice: liveLastPrice,
    chartVetoed,
    gauges,
    lanes: laneMeta.lanes,
    spotSeries,
    ...extractComponentGauges(decision),
    paDrilldown: extractPaDrilldown(decision),
    flowMode,
    vetoBreakup: extractVetoBreakup(decision, vetoMode, flowMode),
    vetoReason: decision.priceAction.overallSignal.vetoReason,
    structuralAction: decision.priceAction.overallSignal.structuralAction,
    patternContext: extractPatternContext(decision, spotSeries),
    patternInsights: extractPatternInsights(decision),
    marketRegime: extractMarketRegime(decision, style, {
      flowMode,
      vetoMode,
    }),
  };
}

export interface DeckReplayTradesPayload {
  trades: DeckTradeMarker[];
  pnlSeries: Array<{ t: number; v: number }>;
  pnlNote?: string;
}

export async function buildDeckReplayTradesPayload(
  fastify: FastifyInstance,
  params: { symbol: string; tradingStyle?: string; sessionDate: string },
): Promise<DeckReplayTradesPayload> {
  const style = parseTradingStyle(params.tradingStyle);
  const date = params.sessionDate;
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
      for (const report of coach.trades) {
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
    trades,
    pnlSeries,
    pnlNote:
      trades.length === 0
        ? 'Fills session PnL when /coach finds closed option trades for this date (Fyers tradebook).'
        : undefined,
  };
}

export async function buildDeckReplayPayload(
  fastify: FastifyInstance,
  params: { symbol: string; tradingStyle?: string; sessionDate?: string },
): Promise<DeckReplayPayload> {
  const { sessionDate: todaySessionDate } = getIstSessionClock(
    Date.now(),
    'Asia/Kolkata',
  );
  const date = params.sessionDate ?? todaySessionDate;
  const { vetoMode, flowMode } = resolveDeckPreferences(fastify);

  return getOrBuildDeckReplayPayload(
    fastify,
    {
      symbol: params.symbol,
      tradingStyle: params.tradingStyle,
      sessionDate: date,
      vetoMode,
      flowMode,
      todaySessionDate,
    },
    () =>
      buildDeckReplayPayloadUncached(fastify, {
        ...params,
        sessionDate: date,
        tradingStyle: params.tradingStyle,
      }),
  );
}

async function buildDeckReplayPayloadUncached(
  fastify: FastifyInstance,
  params: { symbol: string; tradingStyle?: string; sessionDate: string },
): Promise<DeckReplayPayload> {
  const style = parseTradingStyle(params.tradingStyle);
  const date = params.sessionDate;
  const { vetoMode, flowMode } = resolveDeckPreferences(fastify);

  const sessionEndIso = `${date}T15:30:00+05:30`;
  const [decision, timeline, optionSnapshots] = await Promise.all([
    fetchDeckTradeDecision(
      fastify,
      params.symbol,
      style,
      vetoMode,
      flowMode,
      { sessionVerified: true },
    ),
    fetchTimeline(fastify, params.symbol, style, {
      sessionOnly: true,
      to: sessionEndIso,
      includeCandles: true,
    }),
    loadOptionChainSnapshotsForSession(
      fastify,
      params.symbol,
      style,
      date,
    ),
  ]);

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

  const points = timeline?.points ?? [];
  let replayPoints = timelineToConvictionSeries(
    points,
    style,
    optionSnapshots,
    vetoMode,
  );
  const { sessionDate: todaySessionDate } = getIstSessionClock(
    Date.now(),
    'Asia/Kolkata',
  );
  const isCurrentSession = date === todaySessionDate;
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
      vetoMode,
      liveSpot,
    );
  }
  const hasHistoricalOptions = optionSnapshots.length > 0;

  const toMs = Date.parse(sessionEndIso);
  const indexSymbol = decision.symbol || params.symbol;
  const timelineWithCandles = await ensureTimelineHasCandles(
    fastify,
    timeline,
    indexSymbol,
    toMs,
  );
  const multiCandles = multiCandlesFromTimeline(timelineWithCandles, toMs);
  const spotSeries = timelineToSpotSeries(points);
  const chartSessionLabel = multiCandles.historical
    ? 'Recent history (pre / post session)'
    : '09:15–15:30 IST';

  const strategyRecommendation = await extractStrategyRecommendation(
    fastify,
    decision,
    style,
    {
      replayNote:
        'Strategy read uses the engine snapshot for this style (not scrubbed per replay minute).',
      replayMode: true,
    },
  );

  return {
    mode: 'replay',
    symbol: indexSymbol,
    symbolLabel: shortSymbol(indexSymbol),
    tradingStyle: String(style),
    sessionDate: date,
    entryThreshold: resolveEntryThreshold(decision, style),
    gauges,
    replayPoints,
    spotSeries,
    spotCandles: multiCandles.c5.length
      ? multiCandles.c5
      : spotSeriesToSyntheticCandles(spotSeries),
    spotCandles5m: multiCandles.c5,
    spotCandles15m: multiCandles.c15,
    spotCandles1h: multiCandles.c1h,
    pnlSeries: [],
    trades: [],
    markers: timelineMarkers(points),
    events: buildDeckEvents(
      timelineMarkers(points),
      timelineToVetoSeries(points),
      [],
    ),
    optionComponents: hasHistoricalOptions
      ? replayPoints[replayPoints.length - 1]?.optionComponents ??
        extractComponentGauges(decision).optionComponents
      : extractComponentGauges(decision).optionComponents,
    optionComponentsNote: hasHistoricalOptions
      ? 'Option chain breakdown from stored 5–15m snapshots · scrub updates both lanes'
      : 'Option chain breakdown is a live read until snapshots accumulate · scrub updates price-action components per minute',
    vetoTimeline: timelineToVetoSeries(points),
    vetoMode,
    flowMode,
    vetoBreakup: extractVetoBreakup(decision, vetoMode, flowMode),
    strategyRecommendation,
    patternInsights: extractPatternInsights(decision),
    patternContext: buildDeckPatternContext(
      decision._debug?.rawPrice as PriceActionResponse,
      spotSeries,
      toMs,
    ),
    chartSessionLabel,
    pnlNote:
      'Loading session PnL from Fyers tradebook…',
    managementContext: {
      hasOpenPosition: false,
      note: 'Replay — historical view. Live position health and management advice are not applicable.',
    } as PositionManagementContext,
    openPositions: {
      asOf: new Date().toISOString(),
      entries: [],
      note: 'Open positions hidden in replay (historical session view).',
    },
  };
}