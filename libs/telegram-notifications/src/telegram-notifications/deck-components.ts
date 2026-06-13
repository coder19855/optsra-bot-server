import {
  alignmentToGaugeValue,
  higherTfToGaugeValue,
  isHigherTfSupportive,
  TimeframeScores,
} from '../technical-analysis/timeframe-alignment';
import { Timeframe } from '../types/technical-analysis';

export interface DeckComponentGauge {
  id: string;
  label: string;
  value: number;
  weight?: number;
  interpretation?: string;
  readout?: string;
  group: 'option' | 'priceAction';
}

const OPTION_LABELS: Record<string, string> = {
  oi: 'Open interest',
  pcr: 'PCR',
  iv: 'Implied vol',
  greeks: 'Greeks',
  trend: 'Trend',
  pain: 'Max pain',
  vix: 'VIX',
  skew: 'Skew',
  ivregime: 'IV regime',
};

const OPTION_ORDER = [
  'oi',
  'trend',
  'greeks',
  'iv',
  'pcr',
  'pain',
  'vix',
  'skew',
];

const PA_ORDER = ['5m', '15m', '1h', 'mtfScore', 'alignment', 'higherTFConfirmation'];

function clampNeedle(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-1, Math.min(1, value));
}

function normalizeKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const OPTION_KEY_ALIASES: Record<string, string> = {
  oipressurescore: 'oi',
  pcrscore: 'pcr',
  atmivscore: 'iv',
  greekscompositescore: 'greeks',
  trendconfirmationscore: 'trend',
  maxpainscore: 'pain',
  indiavixscore: 'vix',
  ivskewscore: 'skew',
};

function resolveOptionKey(name: string, id?: string): string {
  if (id) return id.toLowerCase();
  const normalized = normalizeKey(name);
  return OPTION_KEY_ALIASES[normalized] ?? normalized;
}

export interface PaGaugeContext {
  primaryTimeframe?: Timeframe;
  timeframeScores?: TimeframeScores;
}

export function buildOptionComponentGauges(
  components: Array<{
    name: string;
    id?: string;
    score: number;
    interpretation?: string;
    weightage?: number;
    humanExplanation?: string;
  }>,
): DeckComponentGauge[] {
  const byKey = new Map<string, DeckComponentGauge>();

  for (const comp of components) {
    const key = resolveOptionKey(comp.name, comp.id);
    byKey.set(key, {
      id: key,
      label: OPTION_LABELS[key] ?? comp.name,
      value: clampNeedle(comp.score),
      weight: comp.weightage,
      interpretation: comp.humanExplanation ?? comp.interpretation,
      group: 'option',
    });
  }

  const ordered: DeckComponentGauge[] = [];
  for (const key of OPTION_ORDER) {
    const gauge = byKey.get(key);
    if (gauge) ordered.push(gauge);
  }
  for (const [key, gauge] of byKey) {
    if (!OPTION_ORDER.includes(key)) ordered.push(gauge);
  }
  return ordered;
}

export function buildPriceActionComponentGauges(
  components: Record<
    string,
    { score: number; weightage?: number; explanation?: string }
  >,
  context?: PaGaugeContext,
): DeckComponentGauge[] {
  const labels: Record<string, string> = {
    '5m': '5m structure',
    '15m': '15m structure',
    '1h': '1h structure',
    mtfScore: 'MTF score',
    alignment: 'Align w/ primary',
    higherTFConfirmation: '1h vs primary',
  };

  const primaryTf = context?.primaryTimeframe ?? '15m';
  const tfScores: TimeframeScores = context?.timeframeScores ?? {
    '5m': components['5m']?.score ?? 0,
    '15m': components['15m']?.score ?? 0,
    '1h': components['1h']?.score ?? 0,
  };

  const gauges: DeckComponentGauge[] = [];
  for (const key of PA_ORDER) {
    const comp = components[key];
    if (!comp) continue;
    let value = comp.score;
    let readout: string | undefined;

    if (key === 'alignment') {
      const aligned = Math.round(comp.score);
      value = alignmentToGaugeValue(aligned);
      readout = `${aligned}/3`;
    }
    if (key === 'higherTFConfirmation') {
      const supported = comp.score === 1;
      value = higherTfToGaugeValue(supported, tfScores, primaryTf);
      readout = supported ? 'supports' : value > 0.1 ? 'lean +' : value < -0.1 ? 'lean −' : 'neutral';
    }

    gauges.push({
      id: key,
      label: labels[key] ?? key,
      value: clampNeedle(value),
      weight: comp.weightage,
      interpretation: comp.explanation,
      readout,
      group: 'priceAction',
    });
  }
  return gauges;
}

export function buildReplayPaComponents(
  timeframeScores: Record<string, number>,
  mtfScore: number,
  aligned: number,
  primaryTimeframe: Timeframe = '15m',
): DeckComponentGauge[] {
  const scores: TimeframeScores = {
    '5m': timeframeScores['5m'] ?? 0,
    '15m': timeframeScores['15m'] ?? 0,
    '1h': timeframeScores['1h'] ?? 0,
  };
  const scoresRecord: Record<string, { score: number }> = {
    '5m': { score: scores['5m'] },
    '15m': { score: scores['15m'] },
    '1h': { score: scores['1h'] },
    mtfScore: { score: mtfScore },
    alignment: { score: aligned },
    higherTFConfirmation: {
      score: isHigherTfSupportive(scores, primaryTimeframe) ? 1 : 0,
    },
  };
  return buildPriceActionComponentGauges(scoresRecord, {
    primaryTimeframe,
    timeframeScores: scores,
  });
}