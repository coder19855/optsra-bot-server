import {
  ConfluenceContext,
  PriceActionResponse,
  Timeframe,
  TimelinePoint,
} from '../types/technical-analysis';
import { isHigherTfSupportive } from '../technical-analysis/timeframe-alignment';

export type PaDrilldownTone = 'positive' | 'negative' | 'neutral' | 'warn';

export interface PaDrilldownRow {
  label: string;
  value: string;
  tone?: PaDrilldownTone;
}

export interface PaDrilldownSection {
  id: string;
  title: string;
  rows: PaDrilldownRow[];
}

export interface PaDrilldown {
  primaryTimeframe: Timeframe;
  sections: PaDrilldownSection[];
}

const TIMEFRAMES: Timeframe[] = ['5m', '15m', '1h'];

function fmtScore(value: number | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}`;
}

function scoreTone(value: number | undefined): PaDrilldownTone {
  if (value == null || !Number.isFinite(value) || Math.abs(value) < 0.08) {
    return 'neutral';
  }
  return value > 0 ? 'positive' : 'negative';
}

function fmtNum(value: number | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toFixed(digits);
}

function humanizeToken(token: string): string {
  return token.replace(/_/g, ' ');
}

function countStructure(
  items: Array<{ type: 'bullish' | 'bearish' }> | undefined,
  direction: 'bullish' | 'bearish',
  lookback = 3,
): number {
  if (!items?.length) return 0;
  return items.slice(-lookback).filter((item) => item.type === direction).length;
}

function structureSummary(
  structureElements: PriceActionResponse['structureElements'] | undefined,
  tf: Timeframe,
): string {
  const fvg = structureElements?.fvg?.[tf] ?? [];
  const ob = structureElements?.orderBlocks?.[tf] ?? [];
  const lookback = tf === '1h' ? 2 : 3;
  const bullFvg = countStructure(fvg, 'bullish', lookback);
  const bearFvg = countStructure(fvg, 'bearish', lookback);
  const bullOb = countStructure(ob, 'bullish', lookback);
  const bearOb = countStructure(ob, 'bearish', lookback);
  if (!bullFvg && !bearFvg && !bullOb && !bearOb) return 'none recent';
  return `FVG ${bullFvg}↑/${bearFvg}↓ · OB ${bullOb}↑/${bearOb}↓`;
}

function timeframeSection(
  tf: Timeframe,
  input: PaDrilldownBuildInput,
  isPrimary: boolean,
): PaDrilldownSection {
  const score = input.timeframeScores[tf];
  const rows: PaDrilldownRow[] = [
    {
      label: 'Structure score',
      value: fmtScore(score),
      tone: scoreTone(score),
    },
  ];

  if (input.adx?.[tf] != null) {
    const adx = input.adx[tf];
    rows.push({
      label: 'ADX',
      value: fmtNum(adx, 1),
      tone: adx >= 20 ? 'positive' : adx < 15 ? 'warn' : 'neutral',
    });
  }
  if (input.atr?.[tf] != null) {
    rows.push({ label: 'ATR', value: fmtNum(input.atr[tf], 2) });
  }
  if (input.momentum?.recent?.[tf] != null) {
    const mom = input.momentum.recent[tf];
    rows.push({
      label: 'Recent momentum',
      value: fmtScore(mom),
      tone: scoreTone(mom),
    });
  }
  if (input.momentum?.fakeout?.[tf] != null && input.momentum.fakeout[tf] !== 0) {
    rows.push({
      label: 'Fakeout',
      value: fmtScore(input.momentum.fakeout[tf]),
      tone: scoreTone(input.momentum.fakeout[tf]),
    });
  }
  const candle = input.candlestick?.[tf] ?? input.candlestick?.primary;
  if (candle && candle !== 'none') {
    rows.push({
      label: 'Candlestick',
      value: humanizeToken(candle),
      tone: /bull|hammer/i.test(candle)
        ? 'positive'
        : /bear|shooting/i.test(candle)
          ? 'negative'
          : 'neutral',
    });
  }
  if (input.structureElements) {
    rows.push({
      label: 'FVG / OB',
      value: structureSummary(input.structureElements, tf),
    });
  }

  return {
    id: `tf-${tf}`,
    title: isPrimary ? `${tf} · primary` : tf,
    rows,
  };
}

function marketContextSection(ctx: ConfluenceContext | undefined): PaDrilldownSection | null {
  if (!ctx) return null;

  const rows: PaDrilldownRow[] = [];

  if (ctx.session) {
    rows.push({
      label: 'Session',
      value: `${ctx.session.phase} — ${ctx.session.label}`,
      tone: ctx.session.phase === 'midday' ? 'warn' : 'neutral',
    });
  }
  if (ctx.volatility) {
    const v = ctx.volatility;
    rows.push({
      label: 'Volatility',
      value: `ATR ${v.atrTrend} · ${Math.round(v.atrPercentile)}th pct · ${v.sessionPhase}`,
      tone: v.isDeadMarket ? 'warn' : 'neutral',
    });
    if (v.isDeadMarket) {
      rows.push({ label: 'Dead market', value: 'yes', tone: 'warn' });
    }
  }
  if (ctx.trendQuality) {
    const tq = ctx.trendQuality;
    rows.push({
      label: 'Trend quality',
      value: `${tq.label} · bull ${tq.bullish.toFixed(2)} / bear ${tq.bearish.toFixed(2)}`,
      tone: tq.label === 'weak' || tq.label === 'choppy' ? 'warn' : 'positive',
    });
  }
  if (ctx.chartPattern && ctx.chartPattern !== 'none') {
    const status =
      ctx.chartPatternStatus === 'forming' ? 'forming · ' : '';
    const direction = ctx.chartPatternDirection;
    rows.push({
      label: 'Chart pattern',
      value: `${status}${humanizeToken(ctx.chartPattern)}`,
      tone:
        direction === 'bullish'
          ? 'positive'
          : direction === 'bearish'
            ? 'negative'
            : 'neutral',
    });
  }
  if (ctx.candlestickPrimary && ctx.candlestickPrimary !== 'none') {
    rows.push({
      label: 'Primary candle',
      value: humanizeToken(ctx.candlestickPrimary),
      tone: /bull|hammer|morning|soldiers|piercing/i.test(ctx.candlestickPrimary)
        ? 'positive'
        : /bear|shooting|evening|crows|dark_cloud/i.test(ctx.candlestickPrimary)
          ? 'negative'
          : 'neutral',
    });
  }

  if (!rows.length) return null;
  return { id: 'market-context', title: 'Market context', rows };
}

export interface PaDrilldownBuildInput {
  primaryTimeframe: Timeframe;
  timeframeScores: Record<Timeframe, number>;
  mtfScore?: number;
  aligned?: number;
  higherTfSupport?: boolean;
  levels?: { support: number; resistance: number };
  atr?: Record<Timeframe, number>;
  adx?: Record<Timeframe, number>;
  momentum?: PriceActionResponse['momentum'];
  structureElements?: PriceActionResponse['structureElements'];
  candlestick?: {
    primary?: string;
    '5m'?: string;
    '15m'?: string;
    '1h'?: string;
  };
  confluenceContext?: ConfluenceContext;
  confluenceSummary?: string;
  signal?: {
    action: string;
    confidence: number;
    strength?: string;
    vetoReason?: string;
    structuralAction?: string;
  };
  momentumDecay?: {
    decayPercent: number;
    reasons?: string[];
    confidenceBefore?: number;
    confidenceAfter?: number;
  };
}

export function buildPaDrilldown(input: PaDrilldownBuildInput): PaDrilldown {
  const sections: PaDrilldownSection[] = [];

  for (const tf of TIMEFRAMES) {
    sections.push(
      timeframeSection(tf, input, tf === input.primaryTimeframe),
    );
  }

  const confluenceRows: PaDrilldownRow[] = [];
  if (input.mtfScore != null) {
    confluenceRows.push({
      label: 'MTF score',
      value: fmtScore(input.mtfScore),
      tone: scoreTone(input.mtfScore),
    });
  }
  if (input.aligned != null) {
    confluenceRows.push({
      label: 'Align w/ primary',
      value: `${input.aligned}/3`,
      tone: input.aligned >= 2 ? 'positive' : input.aligned === 1 ? 'warn' : 'negative',
    });
  }
  if (input.higherTfSupport != null) {
    confluenceRows.push({
      label: '1h vs primary',
      value: input.higherTfSupport ? 'supports' : 'not confirmed',
      tone: input.higherTfSupport ? 'positive' : 'warn',
    });
  }
  if (input.confluenceSummary) {
    confluenceRows.push({ label: 'Summary', value: input.confluenceSummary });
  }
  if (confluenceRows.length) {
    sections.push({ id: 'confluence', title: 'Confluence', rows: confluenceRows });
  }

  const market = marketContextSection(input.confluenceContext);
  if (market) sections.push(market);

  if (input.levels && (input.levels.support || input.levels.resistance)) {
    sections.push({
      id: 'levels',
      title: 'Levels',
      rows: [
        { label: 'Support', value: fmtNum(input.levels.support, 2) },
        { label: 'Resistance', value: fmtNum(input.levels.resistance, 2) },
      ],
    });
  }

  if (input.signal) {
    const sig = input.signal;
    const gateRows: PaDrilldownRow[] = [
      {
        label: 'Chart action',
        value: sig.action,
        tone:
          sig.action === 'CE-BUY'
            ? 'positive'
            : sig.action === 'PE-BUY'
              ? 'negative'
              : 'neutral',
      },
      {
        label: 'PA confidence',
        value: `${Math.round(sig.confidence)}%`,
        tone: sig.confidence >= 60 ? 'positive' : sig.confidence >= 35 ? 'warn' : 'neutral',
      },
    ];
    if (sig.strength) {
      gateRows.push({ label: 'Strength', value: sig.strength });
    }
    if (sig.structuralAction && sig.structuralAction !== sig.action) {
      gateRows.push({
        label: 'Structural read',
        value: sig.structuralAction,
        tone: 'warn',
      });
    }
    if (sig.vetoReason) {
      gateRows.push({ label: 'Veto reason', value: sig.vetoReason, tone: 'warn' });
    } else if (sig.action === 'NO-TRADE') {
      gateRows.push({
        label: 'Veto reason',
        value: 'No directional chart entry',
        tone: 'neutral',
      });
    }
    sections.push({ id: 'signal-gates', title: 'Signal & gates', rows: gateRows });
  }

  if (input.momentumDecay?.decayPercent) {
    const decayRows: PaDrilldownRow[] = [
      {
        label: 'Decay applied',
        value: `${input.momentumDecay.decayPercent.toFixed(1)}%`,
        tone: 'warn',
      },
    ];
    if (
      input.momentumDecay.confidenceBefore != null &&
      input.momentumDecay.confidenceAfter != null
    ) {
      decayRows.push({
        label: 'Confidence',
        value: `${input.momentumDecay.confidenceBefore}% → ${input.momentumDecay.confidenceAfter}%`,
        tone: 'warn',
      });
    }
    for (const reason of input.momentumDecay.reasons ?? []) {
      if (reason.trim()) {
        decayRows.push({ label: 'Factor', value: reason, tone: 'warn' });
      }
    }
    sections.push({ id: 'momentum-decay', title: 'Momentum decay', rows: decayRows });
  }

  return {
    primaryTimeframe: input.primaryTimeframe,
    sections,
  };
}

export function buildPaDrilldownFromPriceAction(
  price: PriceActionResponse,
): PaDrilldown {
  return buildPaDrilldown({
    primaryTimeframe: price.primaryTimeframe as Timeframe,
    timeframeScores: price.timeframeScores,
    mtfScore: price.confluence.mtfScore,
    aligned: price.confluence.aligned,
    higherTfSupport: price.confluence.higherTimeframeConfirmation,
    levels: price.levels,
    atr: price.atr,
    adx: price.adx,
    momentum: price.momentum,
    structureElements: price.structureElements,
    candlestick: price.candlestick,
    confluenceContext: price.confluenceContext,
    confluenceSummary: price.confluence.summary,
    signal: price.signal,
    momentumDecay: price.momentumDecay,
  });
}

export function buildPaDrilldownFromTimelinePoint(
  point: TimelinePoint,
): PaDrilldown {
  const higherTfSupport = isHigherTfSupportive(
    point.timeframeScores,
    point.primaryTimeframe,
  );
  return buildPaDrilldown({
    primaryTimeframe: point.primaryTimeframe,
    timeframeScores: point.timeframeScores,
    mtfScore: point.mtfScore,
    aligned: point.aligned,
    higherTfSupport,
    levels: point.levels,
    atr: point.atr,
    adx: point.momentum.adx,
    momentum: point.momentum,
    structureElements: point.structureElements,
    candlestick: point.candlestick,
    confluenceContext: point.confluenceContext,
    signal: point.signal,
    momentumDecay: point.momentumDecay,
  });
}