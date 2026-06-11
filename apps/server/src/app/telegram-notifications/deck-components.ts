export interface DeckComponentGauge {
  id: string;
  label: string;
  value: number;
  weight?: number;
  interpretation?: string;
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

export function buildOptionComponentGauges(
  components: Array<{
    name: string;
    id?: string;
    score: number;
    interpretation?: string;
    weightage?: number;
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
      interpretation: comp.interpretation,
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
): DeckComponentGauge[] {
  const labels: Record<string, string> = {
    '5m': '5m structure',
    '15m': '15m structure',
    '1h': '1h structure',
    mtfScore: 'MTF score',
    alignment: 'TF alignment',
    higherTFConfirmation: '1h confirm',
  };

  const gauges: DeckComponentGauge[] = [];
  for (const key of PA_ORDER) {
    const comp = components[key];
    if (!comp) continue;
    let value = comp.score;
    if (key === 'alignment') value = (value - 1.5) / 1.5;
    if (key === 'higherTFConfirmation') value = value === 1 ? 0.6 : -0.2;

    gauges.push({
      id: key,
      label: labels[key] ?? key,
      value: clampNeedle(value),
      weight: comp.weightage,
      interpretation: comp.explanation,
      group: 'priceAction',
    });
  }
  return gauges;
}

export function buildReplayPaComponents(
  timeframeScores: Record<string, number>,
  mtfScore: number,
  aligned: number,
): DeckComponentGauge[] {
  const scores: Record<string, { score: number }> = {
    '5m': { score: timeframeScores['5m'] ?? 0 },
    '15m': { score: timeframeScores['15m'] ?? 0 },
    '1h': { score: timeframeScores['1h'] ?? 0 },
    mtfScore: { score: mtfScore },
    alignment: { score: aligned },
    higherTFConfirmation: { score: aligned >= 2 ? 1 : 0 },
  };
  return buildPriceActionComponentGauges(scores);
}