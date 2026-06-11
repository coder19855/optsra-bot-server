import momentumDecayPlugin from './momentum-decay';
import { buildPluginApp } from '../testing/fastify-test-harness';

describe('momentum-decay plugin', () => {
  it('returns zero decay for neutral direction', async () => {
    const app = await buildPluginApp(momentumDecayPlugin);
    const result = app.momentumDecayPlugin.computeMomentumDecay({
      direction: 'neutral',
      score5m: 0.2,
      score15m: 0.1,
      lastPrice: 25000,
      resistance: 25100,
      support: 24900,
      adx5m: 20,
      adx15m: 22,
      adx1h: 18,
      primaryTF: '15m',
    });
    expect(result).toEqual({ decayPercent: 0, reasons: [] });
    await app.close();
  });

  it('applies decay percent to conviction', async () => {
    const app = await buildPluginApp(momentumDecayPlugin);
    expect(app.momentumDecayPlugin.applyMomentumDecay(80, 0.25)).toBe(60);
    await app.close();
  });

  it('counts directional structure elements', async () => {
    const app = await buildPluginApp(momentumDecayPlugin);
    const count = app.momentumDecayPlugin.countDirectionalStructure(
      [
        { type: 'bearish', timeframe: '15m', price: 1, createdAt: 1 },
        { type: 'bullish', timeframe: '15m', price: 2, createdAt: 2 },
      ],
      'bearish',
    );
    expect(count).toBe(1);
    await app.close();
  });

  it('decays bearish conviction near resistance with weak ADX', async () => {
    const app = await buildPluginApp(momentumDecayPlugin);
    const result = app.momentumDecayPlugin.computeMomentumDecay({
      direction: 'bearish',
      score5m: -0.25,
      score15m: -0.3,
      lastPrice: 25095,
      resistance: 25100,
      support: 24900,
      adx5m: 12,
      adx15m: 14,
      adx1h: 10,
      primaryTF: '15m',
    });
    expect(result.decayPercent).toBeGreaterThan(0);
    expect(result.reasons.length).toBeGreaterThan(0);
    await app.close();
  });
});