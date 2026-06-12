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

export interface DeckPatternContext {
  candlestick?: CandlestickPatternId;
  chart?: ChartPatternId;
  chartStatus?: PatternStatus;
  label: string;
  markers: DeckPatternMarker[];
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

export function buildDeckPatternContext(
  price: PriceActionResponse,
  spotSeriesTail: Array<{ t: number }>,
): DeckPatternContext | undefined {
  const candlestick = price.candlestick?.primary;
  const chart = price.confluenceContext?.chartPattern;
  const chartStatus = price.confluenceContext?.chartPatternStatus;
  const hasCandle = candlestick && candlestick !== 'none';
  const hasChart = chart && chart !== 'none';

  if (!hasCandle && !hasChart) return undefined;

  const parts: string[] = [];
  if (hasCandle) {
    parts.push(humanizeToken(candlestick));
  }
  if (hasChart) {
    const prefix = chartStatus === 'forming' ? 'forming ' : '';
    parts.push(`${prefix}${humanizeToken(chart)}`);
  }

  const markers: DeckPatternMarker[] = [];
  const anchorT = spotSeriesTail.at(-1)?.t;
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
  };
}