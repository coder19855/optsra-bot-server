import utilsPlugin from './utils';
import explanationPlugin from './explanation';
import { buildPluginApp } from '../testing/fastify-test-harness';

describe('explanation plugin', () => {
  it('builds weighted explanations for all indicators', async () => {
    const app = await buildPluginApp(explanationPlugin, async (f) => {
      await f.register(utilsPlugin);
    });
    const explanations = app.explanationPlugin.buildExplanations(
      {
        oi: 0.2,
        pcr: -0.1,
        skew: 0,
        iv: 0.1,
        pain: 0,
        greeks: 0.15,
        vix: 0,
        trend: 0.05,
      },
      14,
    );
    expect(Object.keys(explanations)).toEqual(
      expect.arrayContaining(['oi', 'pcr', 'skew', 'iv', 'pain', 'greeks', 'vix', 'trend']),
    );
    expect(explanations.oi.weightage).toBeGreaterThan(0);
    await app.close();
  });
});