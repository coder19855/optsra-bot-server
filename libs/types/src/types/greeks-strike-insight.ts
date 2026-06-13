export type GreeksMoneyness = 'ATM' | 'ITM' | 'OTM';

export type GreeksGammaLevel = 'high' | 'moderate' | 'low';

export interface GreeksStrikeProfile {
  moneyness: GreeksMoneyness;
  strike: number;
  premium: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  gammaLevel: GreeksGammaLevel;
  thetaLabel: string | null;
  consequence: string;
}

export interface GreeksStrikeInsight {
  optionSide: 'CE' | 'PE';
  profiles: GreeksStrikeProfile[];
  bestFit: string;
  ivNote: string | null;
}

export interface GreeksStrikeInsightPair {
  CE: GreeksStrikeInsight | null;
  PE: GreeksStrikeInsight | null;
}