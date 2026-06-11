import sensiblePlugin from './sensible';
import { buildPluginApp } from '../testing/fastify-test-harness';

describe('sensible plugin', () => {
  it('registers fastify-sensible helpers', async () => {
    const app = await buildPluginApp(sensiblePlugin);
    expect(app.httpErrors).toBeDefined();
    expect(app.httpErrors.badRequest).toEqual(expect.any(Function));
    expect(app.httpErrors.badRequest().statusCode).toBe(400);
    await app.close();
  });
});