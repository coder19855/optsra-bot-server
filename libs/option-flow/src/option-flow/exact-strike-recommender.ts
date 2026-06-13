import { FyersAPI } from 'fyers-api-v3';
import { FYERS_OPTION_INDEX_SYMBOLS } from '../constants/fyers-symbols';
import { OptionType } from '../types/options';
import {
  ExactStrikeRecommendation,
  ExactStrikeRecommendationPair,
} from '../types/exact-strike-recommendation';
import {
  GreeksMoneyness,
  GreeksStrikeInsight,
} from '../types/greeks-strike-insight';
import { TradingStyle } from '../types/trading-style';

function indexMeta(indexSymbol: string) {
  return (
    FYERS_OPTION_INDEX_SYMBOLS.find((row) => row.symbol === indexSymbol) ?? {
      shortName: indexSymbol.split(':')[1]?.replace('-INDEX', '') ?? indexSymbol,
      lotSize: 1,
    }
  );
}

function pickMoneyness(
  tradingStyle: TradingStyle,
  conviction: number,
  ivRegime: string | undefined,
  belowStyleThreshold: boolean,
): GreeksMoneyness {
  if (belowStyleThreshold) return 'ITM';

  const ivCrushed = (ivRegime || '').toLowerCase().includes('crush');

  if (tradingStyle === TradingStyle.Scalper) return 'ATM';

  if (tradingStyle === TradingStyle.Positional) {
    if (ivCrushed && conviction >= 65) return 'ATM';
    return 'ITM';
  }

  if (conviction >= 70) return 'ATM';
  if (conviction >= 55) return 'ATM';
  return 'ITM';
}

function rationaleFor(
  moneyness: GreeksMoneyness,
  tradingStyle: TradingStyle,
  conviction: number,
): string {
  if (moneyness === 'ITM') {
    return `Picked ITM for ${tradingStyle} — higher delta and more forgiving if the move is slower (conviction ${conviction}%).`;
  }
  if (moneyness === 'OTM') {
    return `Picked OTM — cheaper ticket when you need a larger move; only when IV is supportive.`;
  }
  return `Picked ATM for ${tradingStyle} — best gamma/speed balance for intraday directional trades.`;
}

function findChainRow(
  chain: FyersAPI.OptionChainData[],
  strike: number,
  optionSide: 'CE' | 'PE',
): FyersAPI.OptionChainData | undefined {
  const type = optionSide === 'CE' ? OptionType.CE : OptionType.PE;
  return chain.find(
    (row) => row.strike_price === strike && row.option_type === type,
  );
}

export function buildExactStrikeRecommendation(
  chain: FyersAPI.OptionChainData[],
  indexSymbol: string,
  optionSide: 'CE' | 'PE',
  tradingStyle: TradingStyle,
  conviction: number,
  greeksInsight: GreeksStrikeInsight | null | undefined,
  ivRegime: string | undefined,
  belowStyleThreshold: boolean,
): ExactStrikeRecommendation | null {
  if (!greeksInsight?.profiles.length) return null;

  const moneyness = pickMoneyness(
    tradingStyle,
    conviction,
    ivRegime,
    belowStyleThreshold,
  );
  const profile =
    greeksInsight.profiles.find((p) => p.moneyness === moneyness) ??
    greeksInsight.profiles.find((p) => p.moneyness === 'ATM') ??
    greeksInsight.profiles[0];

  const row = findChainRow(chain, profile.strike, optionSide);
  if (!row?.symbol || row.ltp <= 0) return null;

  const meta = indexMeta(indexSymbol);
  const delta = profile.delta ?? (row.greeks?.delta != null ? Math.abs(row.greeks.delta) : null);
  const expectedPremiumMove50Pts =
    delta != null ? Math.round(delta * 50 * 10) / 10 : null;

  return {
    fyersSymbol: row.symbol,
    strike: profile.strike,
    moneyness: profile.moneyness,
    premium: row.ltp,
    delta,
    lotSize: meta.lotSize,
    indexLabel: meta.shortName,
    expectedPremiumMove50Pts,
    rationale: rationaleFor(profile.moneyness, tradingStyle, conviction),
  };
}

export function buildExactStrikeRecommendationPair(
  chain: FyersAPI.OptionChainData[],
  indexSymbol: string,
  tradingStyle: TradingStyle,
  conviction: number,
  greeksInsights: {
    CE: GreeksStrikeInsight | null;
    PE: GreeksStrikeInsight | null;
  },
  ivRegime: string | undefined,
  belowStyleThreshold: boolean,
): ExactStrikeRecommendationPair {
  return {
    CE: buildExactStrikeRecommendation(
      chain,
      indexSymbol,
      'CE',
      tradingStyle,
      conviction,
      greeksInsights.CE,
      ivRegime,
      belowStyleThreshold,
    ),
    PE: buildExactStrikeRecommendation(
      chain,
      indexSymbol,
      'PE',
      tradingStyle,
      conviction,
      greeksInsights.PE,
      ivRegime,
      belowStyleThreshold,
    ),
  };
}