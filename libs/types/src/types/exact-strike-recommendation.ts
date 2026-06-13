import { GreeksMoneyness } from './greeks-strike-insight';

export interface ExactStrikeRecommendation {
  fyersSymbol: string;
  strike: number;
  moneyness: GreeksMoneyness;
  premium: number;
  delta: number | null;
  lotSize: number;
  indexLabel: string;
  /** Approx premium change per 50 index points (per unit). */
  expectedPremiumMove50Pts: number | null;
  rationale: string;
}

export interface ExactStrikeRecommendationPair {
  CE: ExactStrikeRecommendation | null;
  PE: ExactStrikeRecommendation | null;
}