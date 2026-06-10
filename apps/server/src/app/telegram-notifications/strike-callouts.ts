import { ExactStrikeRecommendation } from '../types/exact-strike-recommendation';
import {
  GreeksStrikeInsight,
  GreeksStrikeProfile,
} from '../types/greeks-strike-insight';
import {
  formatSectionHeader,
  iconLine,
  paletteToken,
  scenarioForGammaLevel,
  tintLine,
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
  optionSide: 'CE' | 'PE',
): string | null {
  const pts = Math.abs(spot - profile.strike);
  if (pts > 150) return null;

  const zone =
    profile.moneyness === 'ATM'
      ? 'at-the-money'
      : profile.moneyness === 'ITM'
        ? '1-strike ITM'
        : '1-strike OTM';

  return iconLine(
    '📍',
    tintLine(
      'info',
      `Spot ${formatInr(spot)} · strike ${formatInr(profile.strike)} (${zone} ${optionSide}) — ` +
        `only ${pts} pts away, gamma stays hot (≥85% of ATM Γ).`,
    ),
  );
}

function formatGammaValue(profile: GreeksStrikeProfile): string {
  if (profile.gamma == null) {
    return `Γ ${profile.gammaLevel}`;
  }
  return `Γ ${profile.gamma.toFixed(4)} · ${profile.gammaLevel}`;
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
    tintLine(
      'gamma',
      `<b>${top.moneyness}</b> ${formatInr(top.strike)} · ${formatGammaValue(top)}`,
    ),
    nearMoneyNote(top, params.spot, params.insight.optionSide),
    tintLine(
      'gamma',
      '<i>Fastest premium mover</i> if spot breaks — not a direction forecast.',
    ),
    tintLine('gamma', escapeHtml(top.consequence)),
    runner
      ? tintLine(
          'gamma',
          `Also hot: <b>${runner.moneyness}</b> ${formatInr(runner.strike)}`,
        )
      : null,
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
    tintLine('pick', `<code>${escapeHtml(strike.fyersSymbol)}</code>`),
    tintLine(
      'pick',
      `<b>${strike.moneyness}</b> @ ${formatInr(strike.strike)} · prem ₹${strike.premium.toFixed(1)} · Δ ${strike.delta?.toFixed(2) ?? '—'}${move}`,
    ),
    tintLine('pick', escapeHtml(strike.rationale)),
  ]);
}

function gammaBurstIcon(level: GreeksStrikeProfile['gammaLevel']): string {
  if (level === 'high') return '⚡';
  if (level === 'moderate') return '〰️';
  return '💤';
}

export function gammaRowPrefix(profile: GreeksStrikeProfile): string {
  const token = paletteToken(scenarioForGammaLevel(profile.gammaLevel));
  return `${token.dot}${gammaBurstIcon(profile.gammaLevel)} `;
}

export function formatGreeksSectionHeader(optionSide: 'CE' | 'PE'): string {
  const scenario = optionSide === 'CE' ? 'bullish' : 'bearish';
  return formatSectionHeader(scenario, `Greeks cheat sheet · ${optionSide}`, '📐');
}