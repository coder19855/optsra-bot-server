import { ExactStrikeRecommendation } from '../types/exact-strike-recommendation';
import {
  GreeksStrikeInsight,
  GreeksStrikeProfile,
} from '../types/greeks-strike-insight';
import {
  formatSectionHeader,
  wrapScenarioCallout,
} from './telegram-palette';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatInr(value: number): string {
  return value.toLocaleString('en-IN');
}

function gammaRank(level: GreeksStrikeProfile['gammaLevel']): number {
  if (level === 'high') return 3;
  if (level === 'moderate') return 2;
  return 1;
}

export function pickGammaBlastProfile(
  profiles: GreeksStrikeProfile[],
): GreeksStrikeProfile | null {
  if (!profiles.length) return null;
  const ranked = [...profiles].sort((a, b) => {
    const levelDiff = gammaRank(b.gammaLevel) - gammaRank(a.gammaLevel);
    if (levelDiff !== 0) return levelDiff;
    return (b.gamma ?? 0) - (a.gamma ?? 0);
  });
  return ranked[0] ?? null;
}

function nearMoneyNote(
  profile: GreeksStrikeProfile,
  spot: number,
): string | null {
  const pts = Math.abs(spot - profile.strike);
  if (pts > 150) return null;
  return `📍 ${pts} pts from spot`;
}

function formatGammaValue(profile: GreeksStrikeProfile): string {
  if (profile.gamma == null) return profile.gammaLevel;
  return `${profile.gamma.toFixed(4)} (${profile.gammaLevel})`;
}

export function formatGammaBlastCallout(params: {
  insight: GreeksStrikeInsight;
  spot: number;
}): string | null {
  const top = pickGammaBlastProfile(params.insight.profiles);
  if (!top) return null;

  const runner = params.insight.profiles.find(
    (profile) =>
      profile.strike !== top.strike && profile.gammaLevel === 'high',
  );

  const body = [
    `<b>${top.moneyness}</b> ${formatInr(top.strike)} · Γ ${formatGammaValue(top)}`,
    nearMoneyNote(top, params.spot),
    runner ? `Also hot: ${runner.moneyness} ${formatInr(runner.strike)}` : null,
  ].filter((line): line is string => line != null);

  return wrapScenarioCallout(
    'gamma',
    `<b>GAMMA BLAST · ${params.insight.optionSide}</b>`,
    body,
  );
}

export function formatEnginePickCallout(
  strike: ExactStrikeRecommendation,
  title = '<b>ENGINE PICK</b>',
): string {
  const move =
    strike.expectedPremiumMove50Pts != null
      ? ` · ~₹${strike.expectedPremiumMove50Pts.toFixed(1)}/50pts`
      : '';

  return wrapScenarioCallout('pick', title, [
    `<code>${escapeHtml(strike.fyersSymbol)}</code>`,
    `${strike.moneyness} @ ${formatInr(strike.strike)} · ₹${strike.premium.toFixed(1)} · Δ ${strike.delta?.toFixed(2) ?? '—'}${move}`,
  ]);
}

function gammaBurstIcon(level: GreeksStrikeProfile['gammaLevel']): string {
  if (level === 'high') return '⚡';
  if (level === 'moderate') return '〰️';
  return '💤';
}

export function gammaRowPrefix(profile: GreeksStrikeProfile): string {
  return `${gammaBurstIcon(profile.gammaLevel)} `;
}

export function formatGreeksSectionHeader(optionSide: 'CE' | 'PE'): string {
  const scenario = optionSide === 'CE' ? 'bullish' : 'bearish';
  const label = optionSide === 'CE' ? 'Call strikes' : 'Put strikes';
  return formatSectionHeader(scenario, label, '📐');
}