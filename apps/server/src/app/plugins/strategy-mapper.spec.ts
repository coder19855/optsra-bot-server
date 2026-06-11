import utilsPlugin from './utils';
import strategyMapperPlugin from './strategy-mapper';
import { Strategy } from '../types/options';
import { TradingStyle } from '../types/trading-style';
import { buildPluginApp } from '../testing/fastify-test-harness';

describe('strategy-mapper plugin', () => {
  it('maps bullish intraday score to directional strategies', async () => {
    const app = await buildPluginApp(strategyMapperPlugin, async (f) => {
      await f.register(utilsPlugin);
    });
    const result = app.strategyMapperPlugin.mapStrategiesWithVix(
      72,
      14,
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
    expect(result.strategies.length).toBeGreaterThan(0);
    expect(result.strategies.some((s) => /call|bull/i.test(s.strategy))).toBe(
      true,
    );
    await app.close();
  });

  it('computes positive OI impact for aligned bullish strategy', async () => {
    const app = await buildPluginApp(strategyMapperPlugin, async (f) => {
      await f.register(utilsPlugin);
    });
    const { impact } = app.strategyMapperPlugin.computeImpactForStrategy(
      Strategy.LongCall,
      {
        oi: 0.4,
        pcr: 0.2,
        skew: 0,
        iv: 0,
        pain: 0,
        greeks: 0.1,
        vix: 0,
        trend: 0.1,
      },
    );
    expect(impact.oi).toBe('positive');
    await app.close();
  });

  it('maps bearish score to put-side strategies', async () => {
    const app = await buildPluginApp(strategyMapperPlugin, async (f) => {
      await f.register(utilsPlugin);
    });
    const result = app.strategyMapperPlugin.mapStrategiesWithVix(
      -68,
      18,
      {
        oi: -0.3,
        pcr: -0.2,
        skew: -0.1,
        iv: 0.1,
        pain: 0,
        greeks: -0.2,
        vix: 0,
        trend: -0.1,
      },
      TradingStyle.Positional,
    );
    expect(result.strategies.some((s) => /put|bear/i.test(s.strategy))).toBe(
      true,
    );
    await app.close();
  });
});