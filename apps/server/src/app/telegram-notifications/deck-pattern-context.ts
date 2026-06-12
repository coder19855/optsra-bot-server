import {
  CandlestickPatternId,
  ChartPatternId,
  PatternStatus,
  PriceActionResponse,
} from '../types/technical-analysis';

export interface DeckPatternMarker {
  t: number;
  label: string;
  tone: 'bull' | 'bear' | 'neutral';
}

export interface DeckChartOverlay {
  kind: 'support' | 'resistance' | 'neckline';
  price: number;
  label: string;
  tone: 'bull' | 'bear' | 'neutral';
  dashed?: boolean;
}

export interface DeckChartSession {
  fromMs: number;
  toMs: number;
  closeMs: number;
  label: string;
}

export interface DeckPatternContext {
  candlestick?: CandlestickPatternId;
  chart?: ChartPatternId;
  chartStatus?: PatternStatus;
  label: string;
  markers: DeckPatternMarker[];
  overlays: DeckChartOverlay[];
  session: DeckChartSession;
}

function humanizeToken(token: string): string {
  return token.replace(/_/g, ' ');
}

function toneForDirection(
  direction: 'bullish' | 'bearish' | 'neutral' | undefined,
): 'bull' | 'bear' | 'neutral' {
  if (direction === 'bullish') return 'bull';
  if (direction === 'bearish') return 'bear';
  return 'neutral';
}

function candleDirection(
  pattern: CandlestickPatternId,
): 'bullish' | 'bearish' | 'neutral' {
  if (/bull|hammer|morning|soldiers|piercing/i.test(pattern)) return 'bullish';
  if (/bear|shooting|evening|crows|dark_cloud/i.test(pattern)) return 'bearish';
  return 'neutral';
}

function chartDirection(
  pattern: ChartPatternId,
): 'bullish' | 'bearish' | 'neutral' {
  const bullish: ChartPatternId[] = [
    'double_bottom',
    'inverse_head_and_shoulders',
    'bull_flag',
    'falling_wedge',
    'triangle_ascending',
    'range_breakout_bull',
    'trendline_break_bull',
  ];
  const bearish: ChartPatternId[] = [
    'double_top',
    'head_and_shoulders',
    'bear_flag',
    'rising_wedge',
    'triangle_descending',
    'range_breakout_bear',
    'trendline_break_bear',
  ];
  if (bullish.includes(pattern)) return 'bullish';
  if (bearish.includes(pattern)) return 'bearish';
  return 'neutral';
}

export function buildIstChartSession(anchorMs: number): DeckChartSession {
  const sessionDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(anchorMs));

  const fromMs = new Date(`${sessionDate}T09:15:00+05:30`).getTime();
  const closeMs = new Date(`${sessionDate}T15:30:00+05:30`).getTime();
  const toMs = Math.min(Math.max(anchorMs, fromMs), closeMs);

  return {
    fromMs,
    toMs,
    closeMs,
    label: '09:15–15:30 IST',
  };
}

function buildOverlays(price: PriceActionResponse): DeckChartOverlay[] {
  const overlays: DeckChartOverlay[] = [];
  const support = price.levels?.support;
  const resistance = price.levels?.resistance;

  if (support != null && support > 0) {
    overlays.push({
      kind: 'support',
      price: support,
      label: 'Support',
      tone: 'bull',
    });
  }
  if (resistance != null && resistance > 0) {
    overlays.push({
      kind: 'resistance',
      price: resistance,
      label: 'Resistance',
      tone: 'bear',
    });
  }

  const chart = price.confluenceContext?.chartPattern;
  const chartStatus = price.confluenceContext?.chartPatternStatus;
  const neckline = price.confluenceContext?.chartPatternNeckline;
  if (chart && chart !== 'none' && neckline != null && neckline > 0) {
    const direction = chartDirection(chart);
    overlays.push({
      kind: 'neckline',
      price: neckline,
      label: chartStatus === 'forming' ? 'Neckline ~' : 'Neckline',
      tone: toneForDirection(direction),
      dashed: chartStatus === 'forming',
    });
  }

  return overlays;
}

export function buildDeckPatternContext(
  price: PriceActionResponse,
  spotSeriesTail: Array<{ t: number }>,
  anchorMs = Date.now(),
): DeckPatternContext {
  const candlestick = price.candlestick?.primary;
  const chart = price.confluenceContext?.chartPattern;
  const chartStatus = price.confluenceContext?.chartPatternStatus;
  const hasCandle = candlestick && candlestick !== 'none';
  const hasChart = chart && chart !== 'none';

  const parts: string[] = [];
  if (hasCandle) {
    parts.push(humanizeToken(candlestick));
  }
  if (hasChart) {
    const prefix = chartStatus === 'forming' ? 'forming ' : '';
    parts.push(`${prefix}${humanizeToken(chart)}`);
  }

  const anchorT = spotSeriesTail.at(-1)?.t ?? anchorMs;
  const markers: DeckPatternMarker[] = [];
  if (anchorT) {
    if (hasCandle) {
      markers.push({
        t: anchorT,
        label: humanizeToken(candlestick),
        tone: toneForDirection(candleDirection(candlestick)),
      });
    }
    if (hasChart) {
      markers.push({
        t: anchorT,
        label:
          chartStatus === 'forming'
            ? `~ ${humanizeToken(chart)}`
            : humanizeToken(chart),
        tone: toneForDirection(chartDirection(chart)),
      });
    }
  }

  return {
    candlestick: hasCandle ? candlestick : undefined,
    chart: hasChart ? chart : undefined,
    chartStatus,
    label: parts.join(' · '),
    markers,
    overlays: buildOverlays(price),
    session: buildIstChartSession(anchorT),
  };
}