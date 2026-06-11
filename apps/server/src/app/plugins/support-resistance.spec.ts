import supportResistancePlugin from './support-resistance';
import { buildPluginApp } from '../testing/fastify-test-harness';
import { sampleOptionChain } from '../testing/fixtures';

describe('support-resistance plugin', () => {
  it('returns null levels for empty chain', async () => {
    const app = await buildPluginApp(supportResistancePlugin);
    expect(app.supportResistancePlugin.getSupportResistance([])).toEqual({
      overallSupport: null,
      overallResistance: null,
      intradaySupport: null,
      intradayResistance: null,
    });
    await app.close();
  });

  it('returns strike levels for populated chain', async () => {
    const app = await buildPluginApp(supportResistancePlugin);
    const levels = app.supportResistancePlugin.getSupportResistance(
      sampleOptionChain(25000),
    );
    expect(levels.overallSupport).toEqual(expect.any(Number));
    expect(levels.overallResistance).toEqual(expect.any(Number));
    await app.close();
  });
});