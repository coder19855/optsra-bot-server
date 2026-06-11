import utilsPlugin from './utils';
import metricCalculationPlugin from './metric-calculation';
import { buildPluginApp } from '../testing/fastify-test-harness';
import { sampleOptionChain } from '../testing/fixtures';

describe('metric-calculation plugin', () => {
  it('filters nearby strikes around ATM', async () => {
    const app = await buildPluginApp(metricCalculationPlugin, async (f) => {
      await f.register(utilsPlugin);
    });
    const chain = sampleOptionChain(25000);
    const filtered = app.metricCalculationPlugin.filterNearbyStrikes(
      chain,
      25000,
      2,
    );
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.length).toBeLessThanOrEqual(chain.length);
    await app.close();
  });

  it('returns near-neutral PCR score around 1.0', async () => {
    const app = await buildPluginApp(metricCalculationPlugin, async (f) => {
      await f.register(utilsPlugin);
    });
    const chain = sampleOptionChain(25000);
    const score = app.metricCalculationPlugin.calcPcrScore(chain);
    expect(Math.abs(score)).toBeLessThan(0.5);
    await app.close();
  });

  it('computes OI and IV component scores', async () => {
    const app = await buildPluginApp(metricCalculationPlugin, async (f) => {
      await f.register(utilsPlugin);
    });
    const chain = sampleOptionChain(25000);
    const mc = app.metricCalculationPlugin;

    expect(mc.calcOiPressure(chain, 25000)).toEqual(expect.any(Number));
    expect(mc.calcMaxPainScore(chain, 25000)).toEqual(expect.any(Number));
    expect(mc.calcVixScore(14)).toEqual(expect.any(Number));
    expect(mc.calcTrendConfirmationScore(chain, -0.03, 'aggressive')).toEqual(
      expect.any(Number),
    );

    await app.close();
  });

  it('does not pin greeks score to max bearish from summed gamma', async () => {
    const app = await buildPluginApp(metricCalculationPlugin, async (f) => {
      await f.register(utilsPlugin);
    });
    const chain = sampleOptionChain(25000).map((row) => ({
      ...row,
      oi: row.oi ?? 25000,
      greeks: {
        delta: row.option_type === 'CE' ? 0.35 : -0.35,
        gamma: 0.004,
        vega: 9,
        theta: -4,
        iv: 14,
      },
    }));
    const score = app.metricCalculationPlugin.calcGreeksScore(chain, 25000);
    expect(score).not.toBeNull();
    expect(score!).toBeGreaterThan(-0.95);

    await app.close();
  });
});