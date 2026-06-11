import { getStyleScoringConfig } from './constants/trading-style';
import { TradingStyle } from './types/trading-style';

describe('trading-style config', () => {
  it('returns style-specific scoring weights and thresholds', () => {
    const intraday = getStyleScoringConfig(TradingStyle.Intraday);
    const scalper = getStyleScoringConfig(TradingStyle.Scalper);
    const positional = getStyleScoringConfig(TradingStyle.Positional);

    expect(intraday.convictionThreshold.enter).toBeGreaterThan(
      scalper.convictionThreshold.enter,
    );
    expect(positional.optionFlowWeight).toBeGreaterThan(
      scalper.optionFlowWeight,
    );
    expect(intraday.priceActionWeight + intraday.optionFlowWeight).toBeCloseTo(
      1,
      5,
    );
  });
});