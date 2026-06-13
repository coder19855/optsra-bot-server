import { FyersAPI } from 'fyers-api-v3';
import { FYERS_OPTION_INDEX_SYMBOLS } from '../constants/fyers-symbols';
import { OptionType } from '../types/options';
import { TradingStyle } from '../types/trading-style';
import {
  GreeksMoneyness,
  GreeksStrikeInsight,
  GreeksStrikeProfile,
} from '../types/greeks-strike-insight';

const THETA_API_MIN = 0.01;
const RISK_FREE_RATE = 0.065;

export interface GreeksStrikeContext {
  indexSymbol?: string;
  expiryData?: FyersAPI.ExpiryData[];
}

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

function resolveLotSize(indexSymbol: string | undefined): number {
  if (!indexSymbol) return 1;
  const meta = FYERS_OPTION_INDEX_SYMBOLS.find((row) => row.symbol === indexSymbol);
  return meta?.lotSize ?? 1;
}

function daysToNearestExpiry(
  expiryData: FyersAPI.ExpiryData[] | undefined,
): number | null {
  if (!expiryData?.length) return null;

  const now = Date.now();
  let bestDays: number | null = null;

  for (const row of expiryData) {
    const epochMs = Number(row.expiry) * 1000;
    if (!Number.isFinite(epochMs)) continue;
    const days = (epochMs - now) / 86_400_000;
    if (days <= 0) continue;
    if (bestDays == null || days < bestDays) bestDays = days;
  }

  return bestDays;
}

function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p =
    d *
    t *
    (0.3193815 +
      t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

function ivToSigma(iv: number | null | undefined): number | null {
  if (iv == null || !Number.isFinite(iv) || iv <= 0) return null;
  return iv > 1 ? iv / 100 : iv;
}

function bsPrice(params: {
  spot: number;
  strike: number;
  years: number;
  sigma: number;
  optionSide: 'CE' | 'PE';
}): number | null {
  const { spot, strike, years, sigma, optionSide } = params;
  if (spot <= 0 || strike <= 0 || years <= 0 || sigma <= 0) return null;

  const d1 =
    (Math.log(spot / strike) +
      (RISK_FREE_RATE + 0.5 * sigma * sigma) * years) /
    (sigma * Math.sqrt(years));
  const d2 = d1 - sigma * Math.sqrt(years);

  if (optionSide === 'CE') {
    return (
      spot * normCdf(d1) -
      strike * Math.exp(-RISK_FREE_RATE * years) * normCdf(d2)
    );
  }

  return (
    strike * Math.exp(-RISK_FREE_RATE * years) * normCdf(-d2) -
    spot * normCdf(-d1)
  );
}

function bsDailyTheta(params: {
  spot: number;
  strike: number;
  years: number;
  sigma: number;
  optionSide: 'CE' | 'PE';
}): number | null {
  const { spot, strike, years, sigma, optionSide } = params;
  if (spot <= 0 || strike <= 0 || years <= 0 || sigma <= 0) return null;

  const d1 =
    (Math.log(spot / strike) +
      (RISK_FREE_RATE + 0.5 * sigma * sigma) * years) /
    (sigma * Math.sqrt(years));
  const d2 = d1 - sigma * Math.sqrt(years);
  const nd1 = normPdf(d1);

  const annual =
    optionSide === 'CE'
      ? -(spot * nd1 * sigma) / (2 * Math.sqrt(years)) -
        RISK_FREE_RATE *
          strike *
          Math.exp(-RISK_FREE_RATE * years) *
          normCdf(d2)
      : -(spot * nd1 * sigma) / (2 * Math.sqrt(years)) +
        RISK_FREE_RATE *
          strike *
          Math.exp(-RISK_FREE_RATE * years) *
          normCdf(-d2);

  return annual / 365;
}

function readApiTheta(row: FyersAPI.OptionChainData): number | null {
  const raw = row.greeks?.theta;
  if (raw == null || !Number.isFinite(raw)) return null;
  if (Math.abs(raw) < THETA_API_MIN) return null;
  return raw;
}

function estimateThetaPerUnit(params: {
  row: FyersAPI.OptionChainData;
  spot: number;
  optionSide: 'CE' | 'PE';
  daysToExpiry: number | null;
}): number | null {
  const { row, spot, optionSide, daysToExpiry } = params;
  if (daysToExpiry == null || daysToExpiry <= 0 || spot <= 0) return null;

  const sigma = ivToSigma(row.greeks?.iv);
  if (sigma == null) return null;

  const years = Math.max(daysToExpiry / 365, 1 / (365 * 24));
  const modelPrice = bsPrice({
    spot,
    strike: row.strike_price,
    years,
    sigma,
    optionSide,
  });
  const modelTheta = bsDailyTheta({
    spot,
    strike: row.strike_price,
    years,
    sigma,
    optionSide,
  });

  if (modelTheta == null) return null;

  const marketPremium = row.ltp > 0 ? row.ltp : null;
  if (
    marketPremium != null &&
    modelPrice != null &&
    modelPrice > 0.05
  ) {
    return modelTheta * (marketPremium / modelPrice);
  }

  return modelTheta;
}

function resolveThetaPerUnit(params: {
  row: FyersAPI.OptionChainData;
  spot: number;
  optionSide: 'CE' | 'PE';
  daysToExpiry: number | null;
}): number | null {
  return (
    readApiTheta(params.row) ??
    estimateThetaPerUnit(params)
  );
}

/** Per-lot daily decay label — Fyers often returns 0 for theta in the chain API. */
export function formatThetaDecayLabel(
  thetaPerUnit: number | null,
  lotSize = 1,
): string | null {
  if (thetaPerUnit == null || lotSize <= 0) return null;

  const perLot = Math.abs(thetaPerUnit * lotSize);
  if (perLot < 0.5) return null;

  if (perLot >= 100) return `₹${perLot.toFixed(0)}/lot·day`;
  if (perLot >= 10) return `₹${perLot.toFixed(1)}/lot·day`;
  return `₹${perLot.toFixed(2)}/lot·day`;
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
  spot: number,
  daysToExpiry: number | null,
  lotSize: number,
): GreeksStrikeProfile | null {
  if (!row) return null;

  const delta = row.greeks?.delta ?? null;
  const gamma = row.greeks?.gamma ?? null;
  const theta = resolveThetaPerUnit({
    row,
    spot,
    optionSide,
    daysToExpiry,
  });
  const level = gammaLevel(gamma, atmGamma);

  return {
    moneyness,
    strike: row.strike_price,
    premium: row.ltp > 0 ? row.ltp : null,
    delta: delta != null ? Math.abs(delta) : null,
    gamma,
    theta,
    gammaLevel: level,
    thetaLabel: formatThetaDecayLabel(theta, lotSize),
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
  context?: GreeksStrikeContext,
): GreeksStrikeInsight | null {
  if (chain.length === 0 || spot <= 0) return null;

  const optionType = optionSide === 'CE' ? OptionType.CE : OptionType.PE;
  const sideChain = chain.filter((row) => row.option_type === optionType);
  if (sideChain.length === 0) return null;

  const lotSize = resolveLotSize(context?.indexSymbol);
  const daysToExpiry = daysToNearestExpiry(context?.expiryData);

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
    buildProfile(
      'ATM',
      atmRow,
      atmGamma,
      optionSide,
      ivRegime,
      spot,
      daysToExpiry,
      lotSize,
    ),
    itmStrike != null
      ? buildProfile(
          'ITM',
          findRow(sideChain, itmStrike, optionType),
          atmGamma,
          optionSide,
          ivRegime,
          spot,
          daysToExpiry,
          lotSize,
        )
      : null,
    otmStrike != null
      ? buildProfile(
          'OTM',
          findRow(sideChain, otmStrike, optionType),
          atmGamma,
          optionSide,
          ivRegime,
          spot,
          daysToExpiry,
          lotSize,
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

function resolveLegMoneyness(
  strike: number,
  atmStrike: number,
  optionSide: 'CE' | 'PE',
): GreeksMoneyness {
  if (strike === atmStrike) return 'ATM';
  if (optionSide === 'CE') return strike < atmStrike ? 'ITM' : 'OTM';
  return strike > atmStrike ? 'ITM' : 'OTM';
}

/** Greeks profile for a specific open-leg strike (not only ATM/ITM/OTM ladder). */
export function buildLegGreeksProfile(params: {
  chain: FyersAPI.OptionChainData[];
  spot: number;
  optionSide: 'CE' | 'PE';
  strike: number;
  ivRegime?: string;
  context?: GreeksStrikeContext;
}): GreeksStrikeProfile | null {
  const { chain, spot, optionSide, strike, ivRegime, context } = params;
  if (chain.length === 0 || spot <= 0 || strike <= 0) return null;

  const optionType = optionSide === 'CE' ? OptionType.CE : OptionType.PE;
  const sideChain = chain.filter((row) => row.option_type === optionType);
  if (sideChain.length === 0) return null;

  const row = findRow(sideChain, strike, optionType);
  if (!row) return null;

  const lotSize = resolveLotSize(context?.indexSymbol);
  const daysToExpiry = daysToNearestExpiry(context?.expiryData);
  const strikes = sortedStrikes(sideChain);
  const atmStrike = nearestAtmStrike(strikes, spot);
  const atmRow = findRow(sideChain, atmStrike, optionType);
  const atmGamma = atmRow?.greeks?.gamma ?? null;
  const moneyness = resolveLegMoneyness(strike, atmStrike, optionSide);

  return buildProfile(
    moneyness,
    row,
    atmGamma,
    optionSide,
    ivRegime,
    spot,
    daysToExpiry,
    lotSize,
  );
}

export function buildGreeksStrikeInsightPair(
  chain: FyersAPI.OptionChainData[],
  spot: number,
  tradingStyle: TradingStyle,
  ivRegime?: string,
  convictionHint: 'low' | 'normal' = 'normal',
  context?: GreeksStrikeContext,
): { CE: GreeksStrikeInsight | null; PE: GreeksStrikeInsight | null } {
  return {
    CE: buildGreeksStrikeInsight(
      chain,
      spot,
      'CE',
      tradingStyle,
      ivRegime,
      convictionHint,
      context,
    ),
    PE: buildGreeksStrikeInsight(
      chain,
      spot,
      'PE',
      tradingStyle,
      ivRegime,
      convictionHint,
      context,
    ),
  };
}