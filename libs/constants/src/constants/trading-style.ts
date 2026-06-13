import {
  StyleScoringConfig,
  TradingStyle,
} from '../types/trading-style';

/** Style-aware PA vs option-flow weighting and conviction gates. */
export const STYLE_SCORING_CONFIG: Record<TradingStyle, StyleScoringConfig> = {
  [TradingStyle.Scalper]: {
    priceActionWeight: 0.85,
    optionFlowWeight: 0.15,
    convictionThreshold: { enter: 40, medium: 45, strong: 55 },
  },
  [TradingStyle.Intraday]: {
    priceActionWeight: 0.65,
    optionFlowWeight: 0.35,
    convictionThreshold: { enter: 60, medium: 60, strong: 70 },
  },
  [TradingStyle.Positional]: {
    priceActionWeight: 0.35,
    optionFlowWeight: 0.65,
    convictionThreshold: { enter: 62, medium: 66, strong: 70 },
  },
};

export function getStyleScoringConfig(
  style: TradingStyle,
): StyleScoringConfig {
  return STYLE_SCORING_CONFIG[style];
}