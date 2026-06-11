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
});