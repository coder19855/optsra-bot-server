import fp from 'fastify-plugin';
import fyersUsagePlugin from './fyers-usage';
import { buildPluginApp } from '../testing/fastify-test-harness';

describe('fyers-usage plugin', () => {
  it('tracks wrapped fyers method calls', async () => {
    const get_profile = jest.fn().mockResolvedValue({ s: 'ok' });
    const app = await buildPluginApp(fyersUsagePlugin, async (f) => {
      await f.register(
        fp(
          async (instance) => {
            instance.decorate('fyers', { get_profile });
          },
          { name: 'fyers' },
        ),
      );
    });
    app.fyersUsage.beginScope('test');
    await app.fyers.get_profile();
    app.fyersUsage.endScope('test');
    const stats = app.fyersUsage.getStats();
    expect(stats.totals.sessionToday).toBeGreaterThanOrEqual(1);
    expect(stats.totals.byMethodSession.get_profile).toBeGreaterThanOrEqual(1);
    await app.close();
  });
});