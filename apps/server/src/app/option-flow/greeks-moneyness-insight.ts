import { FyersAPI } from 'fyers-api-v3';
import { OptionType } from '../types/options';
import { TradingStyle } from '../types/trading-style';
import {
  GreeksMoneyness,
  GreeksStrikeInsight,
  GreeksStrikeProfile,
} from '../types/greeks-strike-insight';

function sortedStrikes(chain: FyersAPI.OptionChainData[]): number[] {
  return [...new Set(chain.map((row) => row.strike_price))].sort((a, b) => a - b);
}

function nearestAtmStrike(strikes: number[], spot: number): number {
  return strikes.reduce((best, strike) =>
    Math.abs(strike - spot) < Math.abs(best - spot) ? strike : best,
  );
}

function findRow(
  chain: FyersAPI.OptionChainData[],
  strike: number,
  optionType: OptionType,
): FyersAPI.OptionChainData | undefined {
  return chain.find(
    (row) => row.strike_price === strike && row.option_type === optionType,
  );
}

function gammaLevel(
  gamma: number | null,
  atmGamma: number | null,
): GreeksStrikeProfile['gammaLevel'] {
  if (gamma == null || atmGamma == null || atmGamma <= 0) return 'moderate';
  const ratio = gamma / atmGamma;
  if (ratio >= 0.85) return 'high';
  if (ratio >= 0.45) return 'moderate';
  return 'low';
}

function formatTheta(theta: number | null): string | null {
  if (theta == null) return null;
  const abs = Math.abs(theta);
  if (abs >= 100) return `₹${abs.toFixed(0)}/day`;
  if (abs >= 10) return `₹${abs.toFixed(1)}/day`;
  return `₹${abs.toFixed(2)}/day`;
}

function consequenceFor(
  moneyness: GreeksMoneyness,
  optionSide: 'CE' | 'PE',
  delta: number | null,
  gammaLevel: GreeksStrikeProfile['gammaLevel'],
  ivRegime: string | undefined,
): string {
  const ivCrushed = (ivRegime || '').toLowerCase().includes('crush');
  const ivExpanded =
    (ivRegime || '').toLowerCase().includes('expand') ||
    (ivRegime || '').toLowerCase().includes('high');

  if (moneyness === 'ATM') {
    if (gammaLevel === 'high') {
      return 'Fast P&L swings — best for quick directional moves; painful if spot pins or chops.';
    }
    return 'Balanced delta — tracks spot with moderate speed; theta still bites in sideways tape.';
  }

  if (moneyness === 'ITM') {
    const deltaNote =
      delta != null && Math.abs(delta) >= 0.6
        ? 'Moves like spot'
        : 'Higher delta than ATM';
    return `${deltaNote} — needs a smaller index move to profit; premium is heavier.`;
  }

  // OTM
  if (ivExpanded) {
    return 'Cheap entry but needs a bigger move; IV crush can hurt even if direction is right.';
  }
  if (ivCrushed) {
    return `Cheap lottery ticket on ${optionSide} — attractive when IV is crushed; bleeds fast if wrong or too early.`;
  }
  return 'Low delta — needs a bigger move to pay; theta bleeds premium if the move is slow or late.';
}

function bestFitHint(
  tradingStyle: TradingStyle,
  ivRegime: string | undefined,
  convictionHint: 'low' | 'normal',
): string {
  const ivCrushed = (ivRegime || '').toLowerCase().includes('crush');

  if (convictionHint === 'low') {
    return 'Conviction is soft — prefer ITM or skip OTM; size down regardless of strike.';
  }

  if (tradingStyle === TradingStyle.Scalper) {
    return ivCrushed
      ? 'Scalper: ATM for gamma bursts; OTM only on a clean impulse with tight time stop.'
      : 'Scalper: ATM for fastest response; avoid OTM when IV is rich — theta + chop will grind you.';
  }

  if (tradingStyle === TradingStyle.Positional) {
    return ivCrushed
      ? 'Positional: slight ITM for delta carry; ATM if you want more gamma on a multi-day trend.'
      : 'Positional: ITM for stock-like follow-through; OTM is a low-probability swing ticket.';
  }

  // Intraday
  return ivCrushed
    ? 'Intraday: ATM or 1-strike ITM for balance; OTM only when conviction and momentum align.'
    : 'Intraday: ATM or ITM — OTM needs a fast trend day; rich IV makes cheap strikes deceptive.';
}

function buildProfile(
  moneyness: GreeksMoneyness,
  row: FyersAPI.OptionChainData | undefined,
  atmGamma: number | null,
  optionSide: 'CE' | 'PE',
  ivRegime: string | undefined,
): GreeksStrikeProfile | null {
  if (!row) return null;

  const delta = row.greeks?.delta ?? null;
  const gamma = row.greeks?.gamma ?? null;
  const theta = row.greeks?.theta ?? null;
  const level = gammaLevel(gamma, atmGamma);

  return {
    moneyness,
    strike: row.strike_price,
    premium: row.ltp > 0 ? row.ltp : null,
    delta: delta != null ? Math.abs(delta) : null,
    gamma,
    theta,
    gammaLevel: level,
    thetaLabel: formatTheta(theta),
    consequence: consequenceFor(
      moneyness,
      optionSide,
      delta,
      level,
      ivRegime,
    ),
  };
}

export function buildGreeksStrikeInsight(
  chain: FyersAPI.OptionChainData[],
  spot: number,
  optionSide: 'CE' | 'PE',
  tradingStyle: TradingStyle,
  ivRegime?: string,
  convictionHint: 'low' | 'normal' = 'normal',
): GreeksStrikeInsight | null {
  if (chain.length === 0 || spot <= 0) return null;

  const optionType = optionSide === 'CE' ? OptionType.CE : OptionType.PE;
  const sideChain = chain.filter((row) => row.option_type === optionType);
  if (sideChain.length === 0) return null;

  const strikes = sortedStrikes(sideChain);
  const atmStrike = nearestAtmStrike(strikes, spot);
  const atmIdx = strikes.indexOf(atmStrike);
  if (atmIdx < 0) return null;

  let itmStrike: number | undefined;
  let otmStrike: number | undefined;

  if (optionSide === 'CE') {
    itmStrike = atmIdx > 0 ? strikes[atmIdx - 1] : undefined;
    otmStrike = atmIdx < strikes.length - 1 ? strikes[atmIdx + 1] : undefined;
  } else {
    itmStrike = atmIdx < strikes.length - 1 ? strikes[atmIdx + 1] : undefined;
    otmStrike = atmIdx > 0 ? strikes[atmIdx - 1] : undefined;
  }

  const atmRow = findRow(sideChain, atmStrike, optionType);
  const atmGamma = atmRow?.greeks?.gamma ?? null;

  const profiles = [
    buildProfile('ATM', atmRow, atmGamma, optionSide, ivRegime),
    itmStrike != null
      ? buildProfile(
          'ITM',
          findRow(sideChain, itmStrike, optionType),
          atmGamma,
          optionSide,
          ivRegime,
        )
      : null,
    otmStrike != null
      ? buildProfile(
          'OTM',
          findRow(sideChain, otmStrike, optionType),
          atmGamma,
          optionSide,
          ivRegime,
        )
      : null,
  ].filter((p): p is GreeksStrikeProfile => p != null);

  if (profiles.length === 0) return null;

  const ivNote = ivRegime
    ? `IV regime: ${ivRegime} — ${(ivRegime || '').toLowerCase().includes('crush') ? 'premium is relatively cheap; OTM/ATM buyers get a tailwind.' : (ivRegime || '').toLowerCase().includes('expand') || (ivRegime || '').toLowerCase().includes('high') ? 'premium is expensive; favor defined risk or ITM if buying.' : 'factor IV into strike choice and hold time.'}`
    : null;

  return {
    optionSide,
    profiles,
    bestFit: bestFitHint(tradingStyle, ivRegime, convictionHint),
    ivNote,
  };
}

export function buildGreeksStrikeInsightPair(
  chain: FyersAPI.OptionChainData[],
  spot: number,
  tradingStyle: TradingStyle,
  ivRegime?: string,
  convictionHint: 'low' | 'normal' = 'normal',
): { CE: GreeksStrikeInsight | null; PE: GreeksStrikeInsight | null } {
  return {
    CE: buildGreeksStrikeInsight(
      chain,
      spot,
      'CE',
      tradingStyle,
      ivRegime,
      convictionHint,
    ),
    PE: buildGreeksStrikeInsight(
      chain,
      spot,
      'PE',
      tradingStyle,
      ivRegime,
      convictionHint,
    ),
  };
}