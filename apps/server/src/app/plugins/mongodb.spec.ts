import mongodbPlugin from './mongodb';
import { buildPluginApp } from '../testing/fastify-test-harness';

describe('mongodb plugin', () => {
  const originalUrl = process.env.MONGODB_URL;

  afterEach(() => {
    if (originalUrl === undefined) {
      delete process.env.MONGODB_URL;
    } else {
      process.env.MONGODB_URL = originalUrl;
    }
  });

  it('skips registration when MONGODB_URL is unset', async () => {
    delete process.env.MONGODB_URL;
    const app = await buildPluginApp(mongodbPlugin);
    expect(app.mongo).toBeUndefined();
    await app.close();
  });

  it('skips registration for localhost URLs', async () => {
    process.env.MONGODB_URL = 'mongodb://127.0.0.1:27017/test';
    const app = await buildPluginApp(mongodbPlugin);
    expect(app.mongo).toBeUndefined();
    await app.close();
  });
});