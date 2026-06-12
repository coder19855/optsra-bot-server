import { extractDeckStrategyPayload } from './deck-strategy';

describe('deck-strategy', () => {
  it('extracts ranked strategies and trade guidance', () => {
    const payload = extractDeckStrategyPayload({
      action: 'NO-TRADE',
      bias: 'Neutral',
      conviction: 17,
      recommendation: 'Wait for better alignment',
      humanSummary: 'Stay flat.',
      tradeGuidance: {
        shouldConsiderTrade: false,
        sizeRecommendation: 'Below style threshold',
        notes: 'Intraday enter >= 60',
        thresholdsForThisStyle: { enter: 60, strong: 75, cautionBelow: 45 },
      },
      recommendedStrategies: [
        {
          strategy: 'Iron Condor',
          risk: 'Low',
          confidenceScore: 62,
          reason: 'IV crushed',
          executionHint: 'Sell wings weekly',
          riskManagement: {
            positionSizing: 'Small',
            stopLoss: '2x credit',
            takeProfit: '50% credit',
            exitStrategy: 'Close at 21 DTE',
          },
        },
      ],
      optionFlow: {
        bias: 'Neutral',
        ivRegime: 'IV Crushed',
      },
    });

    expect(payload.strategies[0]?.strategy).toBe('Iron Condor');
    expect(payload.tradeGuidance.shouldConsiderTrade).toBe(false);
    expect(payload.ivRegime).toBe('IV Crushed');
  });
});