import utilsPlugin from './utils';
import { TradingStyle } from '../types/trading-style';
import { TradeSignal } from '../types';
import { buildPluginApp } from '../testing/fastify-test-harness';

describe('utils plugin', () => {
  it('maps score to trade signal by style threshold', async () => {
    const app = await buildPluginApp(utilsPlugin);
    const { mapSignal } = app.utilsPlugin;
    expect(mapSignal(30, TradingStyle.Scalper)).toBe(TradeSignal.BullishTrade);
    expect(mapSignal(10, TradingStyle.Intraday)).toBe(TradeSignal.NonDirectional);
    expect(mapSignal(-40, TradingStyle.Positional)).toBe(
      TradeSignal.BearishTrade,
    );
    await app.close();
  });

  it('detects IV crushed regime', async () => {
    const app = await buildPluginApp(utilsPlugin);
    expect(app.utilsPlugin.detectIvRegime(0.4, 0, 0)).toBe('IV Crushed');
    await app.close();
  });

  it('calculates weighted final score', async () => {
    const app = await buildPluginApp(utilsPlugin);
    const score = app.utilsPlugin.calcFinalScore(
      {
        oi: 0.3,
        pcr: 0.1,
        skew: 0,
        iv: 0,
        pain: 0,
        greeks: 0.2,
        vix: 0,
        trend: 0.1,
      },
      TradingStyle.Intraday,
    );
    expect(score).toBeGreaterThan(0);
    await app.close();
  });

  it('normalises and interprets indicator ranges', async () => {
    const app = await buildPluginApp(utilsPlugin);
    const { norm, interpretRange, biasFromScore, getScoreWeights } =
      app.utilsPlugin;
    expect(norm(5, 10)).toBeCloseTo(0.5, 1);
    expect(interpretRange(0.6)).toBe('Moderate Bullish');
    expect(biasFromScore(-0.5)).toBe('bearish');
    expect(getScoreWeights(TradingStyle.Scalper).oi).toBeGreaterThan(0);
    await app.close();
  });

  it('computes confidence from indicator alignment', async () => {
    const app = await buildPluginApp(utilsPlugin);
    const confidence = app.utilsPlugin.computeConfidence(
      {
        oi: { interpretation: 'Bullish buildup', weightage: 20 },
        trend: { interpretation: 'Moderate Bullish', weightage: 15 },
        pcr: { interpretation: 'Neutral', weightage: 10 },
      },
      TradeSignal.BullishTrade,
    );
    expect(confidence.percent).toBeGreaterThan(0);
    expect(confidence.totalWeight).toBe(45);
    await app.close();
  });
});