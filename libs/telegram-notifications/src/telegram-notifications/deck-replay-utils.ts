// Use plain types (avoid circular import with deck-service)
type DeckSpotPoint = any;
type DeckCandlePoint = any;
type DeckMarker = any;
type DeckVetoPoint = any;
type DeckTradeMarker = any;
type DeckEvent = any;
type DeckReplayPoint = any;
import { buildDeckVetoBreakup, buildReplayVetoBreakup } from './deck-veto-breakup';
import { buildOptionComponentGauges, buildPriceActionComponentGauges, buildReplayPaComponents } from './deck-components';
import { buildPaDrilldown, buildPaDrilldownFromTimelinePoint } from './deck-pa-drilldown';
import { computeReplayOptionNeedle, computePaNeedleFromConviction } from './deck-gauge';
import { TradingStyle } from '../types/trading-style';
import { VetoMode } from './veto-preference';
import { FlowMode } from '../types/flow-mode';

export function timelineToSpotSeries(points: Array<any>): DeckSpotPoint[] {
  return points.map((p) => ({ t: p.asOf, v: Number(p.spot ?? 0) }));
}

export function timelineToVetoSeries(points: Array<any>): DeckVetoPoint[] {
  return points.map((p) => ({
    t: p.asOf,
    vetoed: (p.signal?.action === 'NO-TRADE' && Boolean(p.signal?.vetoReason)) || false,
    action: p.signal?.action || 'NO-TRADE',
    structuralAction: p.signal?.structuralAction,
    vetoReason: p.signal?.vetoReason,
  }));
}

export function timelineMarkers(points: Array<any>): DeckMarker[] {
  return points.map((p) => ({
    t: p.asOf,
    type: 'signal',
    label: p.signal?.action || 'NO-TRADE',
    action: p.signal?.action || 'NO-TRADE',
  }));
}

export function spotSeriesToSyntheticCandles(spotSeries: DeckSpotPoint[]): DeckCandlePoint[] {
  return spotSeries.map((p) => ({ t: p.t, o: p.v, h: p.v, l: p.v, c: p.v }));
}

export function extractComponentGauges(decision: any) {
  const optionComponents = buildOptionComponentGauges(
    decision.optionFlow?.components ?? [],
  );
  const priceActionComponents = buildPriceActionComponentGauges(
    decision.priceAction?.components ?? {},
    {
      primaryTimeframe:
        (decision.priceAction?.primaryTimeframe as any) ?? '15m',
      timeframeScores: (decision.priceAction?.timeframeScores as any) ?? {},
    },
  );
  return { optionComponents, priceActionComponents };
}

export function buildDeckEvents(markers: DeckMarker[], veto: DeckVetoPoint[], trades: DeckTradeMarker[] = []): DeckEvent[] {
  const events: DeckEvent[] = [];
  for (const m of markers) {
    events.push({ t: m.t, type: 'signal', label: m.label, action: m.action });
  }
  for (const v of veto) {
    events.push({ t: v.t, type: v.vetoed ? 'veto' : 'veto_clear', label: v.action, detail: v.vetoReason, action: v.structuralAction });
  }
  for (const t of trades) {
    events.push({ t: t.t, type: 'trade', label: t.label, detail: String(t.pnlInr), action: t.symbol });
  }
  return events.sort((a, b) => a.t - b.t);
}

export function extractPaDrilldown(decision: any) {
  try {
    return buildPaDrilldown(decision.priceAction as any);
  } catch {
    return buildPaDrilldownFromTimelinePoint({
      asOf: Date.now(),
      asOfISO: new Date().toISOString(),
      spot: decision.lastPrice ?? 0,
      primaryTimeframe: '15m',
      timeframeScores: decision.priceAction?.timeframeScores ?? {},
      mtfScore: decision.priceAction?.mtfScore ?? 0,
      aligned: decision.priceAction?.confluence?.aligned ?? 0,
      signal: decision.priceAction?.overallSignal ?? { action: 'NO-TRADE', confidence: 0 },
      candlestick: decision.priceAction?.candlestick ?? {},
      momentum: decision.priceAction?.momentum ?? { recent: {} },
      atr: decision.priceAction?.atr,
      structureElements: decision.priceAction?.structureElements,
      confluenceContext: decision.priceAction?.confluenceContext,
    } as any);
  }
}

export function extractVetoBreakup(decision: any, vetoMode: VetoMode, flowMode: FlowMode) {
  try {
    return buildDeckVetoBreakup({
      vetoMode,
      flowMode,
      action: decision.action,
      conviction: decision.conviction ?? 0,
      priceConviction: decision.priceConviction ?? 0,
      priceConvictionBeforeDecay: decision.priceConvictionBeforeDecay,
      optionConviction: decision.optionConviction ?? 0,
      enterThreshold: decision.convictionThresholds?.enter ?? 60,
      conflictLevel: decision.conflictLevel,
      alignment: decision.priceAction?.confluence?.aligned,
      paSignal: decision.priceAction?.overallSignal ?? { action: 'NO-TRADE', confidence: 0 },
      momentumDecay: decision.momentumDecay,
      vetoedByDecay: !!decision.momentumDecay?.vetoedByDecay,
      minConfidenceAfterDecay: undefined,
    });
  } catch {
    return buildReplayVetoBreakup({
      vetoMode,
      action: decision.action,
      conviction: decision.conviction ?? 0,
      vetoed: false,
      structuralAction: decision.priceAction?.overallSignal?.structuralAction,
    });
  }
}

export function syncLastReplayPointToLive(
  replayPoints: DeckReplayPoint[],
  decision: any,
  gauges: any,
  vetoMode: VetoMode,
  liveSpot: number,
): DeckReplayPoint[] {
  if (!replayPoints.length) return replayPoints;
  const last = replayPoints[replayPoints.length - 1];
  last.spot = liveSpot;
  last.liveSynced = true;
  if (gauges?.option?.percent != null) last.optionPercent = gauges.option.percent;
  if (gauges?.priceAction?.percent != null) last.paPercent = gauges.priceAction.percent;
  try {
    last.optionNeedle = computeReplayOptionNeedle(last as any, '15m');
    last.paNeedle = computePaNeedleFromConviction(last.conviction ?? 0, last.weightedBaseConviction ?? 0);
  } catch {
    // ignore
  }
  return replayPoints;
}

export function timelineToConvictionSeries(
  points: Array<any>,
  style: TradingStyle,
  optionSnapshots: any[] = [],
  vetoMode: VetoMode = 'strict',
): DeckReplayPoint[] {
  const primaryTf = style === TradingStyle.Scalper ? '5m' : style === TradingStyle.Positional ? '1h' : '15m';
  return points.map((p) => {
    const paComponents = buildReplayPaComponents(p.timeframeScores ?? {}, p.mtfScore ?? 0, p.aligned ?? 0, primaryTf as any);
    const optionNeedle = computeReplayOptionNeedle(p as any, primaryTf as any);
    const paNeedle = computePaNeedleFromConviction(p.signal?.confidence ?? 0, p.timeframeScores?.[primaryTf] ?? 0);
    const optionComponents = optionSnapshots.length ? buildOptionComponentGauges(optionSnapshots[0].components ?? []) : [];
    return {
      t: p.asOf,
      spot: p.spot ?? 0,
      optionNeedle,
      paNeedle,
      optionPercent: p.signal?.confidence ?? 0,
      paPercent: Math.round(Math.abs(p.mtfScore ?? 0) * 100),
      paGhost: null,
      conviction: p.signal?.confidence ?? 0,
      weightedBaseConviction: Math.round(Math.abs(p.mtfScore ?? 0) * 100),
      convictionBonuses: [],
      action: p.signal?.action ?? 'NO-TRADE',
      vetoed: p.signal?.action === 'NO-TRADE' && Boolean(p.signal?.vetoReason),
      vetoReason: p.signal?.vetoReason,
      structuralAction: p.signal?.structuralAction,
      whatIfAction: p.signal?.action ?? 'NO-TRADE',
      whatIfConviction: p.signal?.confidence ?? 0,
      paComponents,
      paDrilldown: buildPaDrilldownFromTimelinePoint(p as any),
      optionComponents,
      vetoBreakup: extractVetoBreakup({ action: p.signal?.action ?? 'NO-TRADE', conviction: p.signal?.confidence ?? 0 } as any, vetoMode, 'blend'),
      liveSynced: false,
    } as DeckReplayPoint;
  });
}
