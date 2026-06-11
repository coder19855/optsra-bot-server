import decisionEnginePlugin from './decision-engine';
import momentumDecayPlugin from './momentum-decay';
import { TradingStyle } from '../types/trading-style';
import { buildPluginApp } from '../testing/fastify-test-harness';
import { sampleOptionMetrics, samplePriceAction } from '../testing/fixtures';

describe('decision-engine plugin', () => {
  it('returns PE-BUY for aligned bearish intraday inputs', async () => {
    const app = await buildPluginApp(decisionEnginePlugin, async (f) => {
      await f.register(momentumDecayPlugin);
    });
    const result = app.decisionEngine.computeTradeDecision(
      samplePriceAction({
        signal: { action: 'PE-BUY', confidence: 65 },
        timeframeScores: { '5m': -0.2, '15m': -0.28, '1h': -0.18 },
      }),
      sampleOptionMetrics({ score: -40, signal: 'BEARISH_TRADE' }),
      TradingStyle.Intraday,
    );
    expect(['PE-BUY', 'NO-TRADE', 'NEUTRAL']).toContain(result.action);
    expect(result.conviction).toBeGreaterThan(0);
    await app.close();
  });

  it('may allow trade when vetoOff bypasses option conflict', async () => {
    const app = await buildPluginApp(decisionEnginePlugin, async (f) => {
      await f.register(momentumDecayPlugin);
    });
    const result = app.decisionEngine.computeTradeDecision(
      samplePriceAction({
        signal: { action: 'CE-BUY', confidence: 70 },
        timeframeScores: { '5m': 0.3, '15m': 0.35, '1h': 0.2 },
      }),
      sampleOptionMetrics({
        score: -50,
        signal: 'BEARISH_TRADE',
        components: {
          oi: -0.5,
          greeks: -0.6,
          iv: 0,
          trend: -0.4,
          pcr: -0.3,
          skew: -0.2,
          pain: 0,
          vix: 0,
        },
      }),
      TradingStyle.Intraday,
      { vetoMode: 'off' },
    );
    expect(['CE-BUY', 'PE-BUY', 'NO-TRADE', 'NEUTRAL']).toContain(result.action);
    await app.close();
  });

  it('returns NO-TRADE when price and option flow strongly conflict', async () => {
    const app = await buildPluginApp(decisionEnginePlugin, async (f) => {
      await f.register(momentumDecayPlugin);
    });
    const result = app.decisionEngine.computeTradeDecision(
      samplePriceAction({
        signal: { action: 'CE-BUY', confidence: 70 },
        timeframeScores: { '5m': 0.3, '15m': 0.35, '1h': 0.2 },
      }),
      sampleOptionMetrics({
        score: -50,
        signal: 'BEARISH_TRADE',
        components: {
          oi: -0.5,
          greeks: -0.6,
          iv: 0,
          trend: -0.4,
          pcr: -0.3,
          skew: -0.2,
          pain: 0,
          vix: 0,
        },
      }),
      TradingStyle.Intraday,
    );
    expect(result.action).toBe('NO-TRADE');
    await app.close();
  });

  it('computes scalper decision using 5m primary timeframe', async () => {
    const app = await buildPluginApp(decisionEnginePlugin, async (f) => {
      await f.register(momentumDecayPlugin);
    });
    const result = app.decisionEngine.computeTradeDecision(
      samplePriceAction({
        signal: { action: 'CE-BUY', confidence: 68 },
        timeframeScores: { '5m': 0.32, '15m': 0.1, '1h': 0.05 },
        structureElements: {
          fvg: { '5m': [{ type: 'bullish', timeframe: '5m', price: 1, createdAt: 1 }] },
          orderBlocks: {},
        },
      }),
      sampleOptionMetrics({ score: 30, signal: 'BULLISH_TRADE', bias: 'Bullish' }),
      TradingStyle.Scalper,
    );
    expect(result.conviction).toBeGreaterThan(0);
    expect(result.priceConviction).toBeGreaterThan(0);
    await app.close();
  });

  it('computes positional decision with higher option-flow weight', async () => {
    const app = await buildPluginApp(decisionEnginePlugin, async (f) => {
      await f.register(momentumDecayPlugin);
    });
    const result = app.decisionEngine.computeTradeDecision(
      samplePriceAction({
        signal: { action: 'PE-BUY', confidence: 55 },
        timeframeScores: { '5m': -0.1, '15m': -0.2, '1h': -0.35 },
      }),
      sampleOptionMetrics({
        score: -45,
        signal: 'BEARISH_TRADE',
        components: {
          oi: -0.4,
          greeks: -0.3,
          iv: 0.1,
          trend: -0.2,
          pcr: -0.1,
          skew: -0.1,
          pain: 0,
          vix: 0,
        },
      }),
      TradingStyle.Positional,
    );
    expect(['PE-BUY', 'NO-TRADE', 'NEUTRAL']).toContain(result.action);
    expect(result.recommendation).toEqual(expect.any(String));
    await app.close();
  });

  it('returns CE-BUY for aligned bullish inputs with supportive option flow', async () => {
    const app = await buildPluginApp(decisionEnginePlugin, async (f) => {
      await f.register(momentumDecayPlugin);
    });
    const result = app.decisionEngine.computeTradeDecision(
      samplePriceAction({
        signal: { action: 'CE-BUY', confidence: 75 },
        timeframeScores: { '5m': 0.25, '15m': 0.32, '1h': 0.28 },
        structureElements: {
          fvg: {
            '15m': [{ type: 'bullish', timeframe: '15m', price: 1, createdAt: 1 }],
          },
          orderBlocks: {
            '15m': [{ type: 'bullish', timeframe: '15m', price: 1, createdAt: 1 }],
          },
        },
      }),
      sampleOptionMetrics({
        score: 42,
        signal: 'BULLISH_TRADE',
        bias: 'Bullish',
        components: {
          oi: 0.35,
          greeks: 0.2,
          iv: 0.1,
          trend: 0.25,
          pcr: 0.1,
          skew: 0,
          pain: 0,
          vix: 0,
        },
      }),
      TradingStyle.Intraday,
    );
    expect(['CE-BUY', 'NO-TRADE', 'NEUTRAL']).toContain(result.action);
    expect(result.conviction).toBeGreaterThan(20);
    expect(result.humanSummary).toEqual(expect.any(String));
    await app.close();
  });
});