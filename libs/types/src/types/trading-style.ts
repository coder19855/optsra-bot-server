export enum TradingStyle {
  Scalper = 'SCALPER',
  Intraday = 'INTRADAY',
  Positional = 'POSITIONAL',
}

export interface StyleScoringConfig {
  priceActionWeight: number;
  optionFlowWeight: number;
  convictionThreshold: {
    enter: number;
    medium: number;
    strong: number;
  };
}