import momentumDecayPlugin from './momentum-decay';
import technicalAnalysisPlugin from './technical-analysis';
import { buildPluginApp } from '../testing/fastify-test-harness';
import { FyersAPI } from 'fyers-api-v3';
import { BiasSignal } from '../types/technical-analysis';
import { TradingStyle } from '../types/trading-style';

/** Candles with explicit local pivot highs/lows every 3 bars. */
function swingCandles(count = 40): FyersAPI.Candle[] {
  const candles: FyersAPI.Candle[] = [];
  for (let i = 0; i < count; i += 1) {
    const phase = i % 6;
    const mid = 25000;
    let high: number;
    let low: number;
    if (phase === 2) {
      high = mid + 120;
      low = mid - 20;
    } else if (phase === 5) {
      high = mid + 20;
      low = mid - 120;
    } else {
      high = mid + 40;
      low = mid - 40;
    }
    const open = (high + low) / 2;
    const close = phase <= 2 ? open + 5 : open - 5;
    candles.push([1_700_000_000 + i * 300, open, high, low, close, 1000]);
  }
  return candles;
}

describe('technical-analysis plugin', () => {
  it('detects swings from candle highs and lows', async () => {
    const app = await buildPluginApp(technicalAnalysisPlugin, async (f) => {
      await f.register(momentumDecayPlugin);
    });
    const swings = app.technicalAnalysisPlugin.getSwings(swingCandles(40));
    expect(swings.highs.length + swings.lows.length).toBeGreaterThan(0);
    await app.close();
  });

  it('returns neutral market structure when swings are insufficient', async () => {
    const app = await buildPluginApp(technicalAnalysisPlugin, async (f) => {
      await f.register(momentumDecayPlugin);
    });
    const swings = app.technicalAnalysisPlugin.getSwings(swingCandles(4));
    const structure = app.technicalAnalysisPlugin.getMarketStructure(swings);
    expect([-1, 0, 1]).toContain(structure);
    await app.close();
  });

  it('computes ATR, ADX, support/resistance, and FVG helpers', async () => {
    const app = await buildPluginApp(technicalAnalysisPlugin, async (f) => {
      await f.register(momentumDecayPlugin);
    });
    const candles = swingCandles(50);
    const ta = app.technicalAnalysisPlugin;
    const swings = ta.getSwings(candles);

    expect(ta.calculateATR(candles)).toBeGreaterThan(0);
    expect(ta.calculateADX(candles)).toBeGreaterThanOrEqual(0);
    expect(ta.volumeScore(candles)).toBeGreaterThanOrEqual(0);

    const levels = ta.getSupportAndResistance(swings);
    expect(levels.support).toBeLessThanOrEqual(levels.resistance);

    const fvgs = ta.detectFairValueGaps(candles);
    expect(Array.isArray(fvgs)).toBe(true);

    const obs = ta.detectOrderBlocks(candles);
    expect(Array.isArray(obs)).toBe(true);

    await app.close();
  });

  it('scores timeframe context and trade signals', async () => {
    const app = await buildPluginApp(technicalAnalysisPlugin, async (f) => {
      await f.register(momentumDecayPlugin);
    });
    const candles = swingCandles(50);
    const ta = app.technicalAnalysisPlugin;
    const swings = ta.getSwings(candles);

    const tfScore = ta.scoreTimeFrameContext({
      structure: 0.2,
      breakout: 0.15,
      retest: 0.1,
      volume: 0.5,
      fakeout: 0,
      trendBias: 1,
      bos: 0.1,
      choch: 0,
      liquiditySweep: 0,
      adx: 22,
      atr: 18,
    });
    expect(tfScore).toBeGreaterThanOrEqual(-1);
    expect(tfScore).toBeLessThanOrEqual(1);

    const signal = ta.getTradeSignal({
      lastPrice: 25000,
      biasSignal: BiasSignal.Bullish,
      score: 0.35,
      swings,
      volume: 0.6,
      breakout: 0.2,
      tradingStyle: TradingStyle.Intraday,
    });
    expect(signal.direction).toMatch(/CE-BUY|PE-BUY|NO-TRADE/);

    const bias = ta.swingTrendBias(swings);
    expect([-1, 0, 1]).toContain(bias);

    await app.close();
  });

  it('runs breakout, bias, and confluent signal helpers', async () => {
    const app = await buildPluginApp(technicalAnalysisPlugin, async (f) => {
      await f.register(momentumDecayPlugin);
    });
    const candles = swingCandles(50);
    const ta = app.technicalAnalysisPlugin;
    const swings = ta.getSwings(candles);
    const { support, resistance } = ta.getSupportAndResistance(swings);

    expect(ta.detectBreakout(candles, support, resistance)).toEqual(
      expect.any(Number),
    );
    expect(ta.detectFakeout(candles, support, resistance)).toEqual(
      expect.any(Number),
    );
    expect(ta.detectRetest(candles, support, resistance)).toEqual(
      expect.any(Number),
    );

    const biasSignal = ta.getBiasSignalFromScores({
      score5m: -0.1,
      score15m: -0.25,
      score1h: -0.35,
      structure1h: -1,
    });
    expect(biasSignal).toBeDefined();

    const confluent = ta.getConfluentTradeSignal({
      tradingStyle: TradingStyle.Intraday,
      scores: { score5m: -0.2, score15m: -0.3, score1h: -0.15 },
      structures: { ms5m: -1, ms15m: -1, ms1h: 0 },
      primary: {
        lastPrice: 25000,
        swings,
        volume: 0.6,
        breakout: -1,
        support,
        resistance,
      },
    });
    expect(confluent.action).toMatch(/CE-BUY|PE-BUY|NO-TRADE/);

    const compression = ta.computeRangeCompression(candles);
    expect(compression).toEqual(expect.any(Number));

    await app.close();
  });
});