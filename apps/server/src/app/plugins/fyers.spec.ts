import { FastifyInstance } from 'fastify';
import fyersPlugin from './fyers';
import { ResponseStatus } from '../types/common';
import { buildPluginApp } from '../testing/fastify-test-harness';

jest.mock('fyers-api-v3', () => {
  const instance = {
    setAppId: jest.fn(),
    setRedirectUrl: jest.fn(),
    setAccessToken: jest.fn(),
    get_profile: jest.fn(),
    initialize: jest.fn().mockResolvedValue(undefined),
    getAccessToken: jest.fn().mockResolvedValue(''),
    isTokenValid: jest.fn().mockResolvedValue(false),
  };
  return { fyersModel: jest.fn(() => instance) };
});

function makeJwt(expOffsetSec = 3600): string {
  const header = Buffer.from(
    JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
  ).toString('base64');
  const payload = Buffer.from(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expOffsetSec }),
  ).toString('base64');
  return `${header}.${payload}.fakesig`;
}

function decorateMongoWithToken(token: string | null) {
  return (fastify: FastifyInstance) => {
    const findOne = jest
      .fn()
      .mockResolvedValue(token ? { token } : null);
    fastify.decorate('mongo', {
      client: {},
      ObjectId: class MockObjectId {},
      db: {
        collection: jest.fn().mockReturnValue({ findOne }),
      },
    });
  };
}

describe('fyers plugin', () => {
  it('decorates fyers and ensureFyersSession', async () => {
    const app = await buildPluginApp(
      fyersPlugin,
      decorateMongoWithToken(makeJwt()),
    );
    expect(app.fyers).toBeDefined();
    expect(app.ensureFyersSession).toBeDefined();
    await expect(app.ensureFyersSession()).resolves.toBe(true);
    await app.close();
  });

  it('ensureFyersSession returns false for invalid token', async () => {
    const app = await buildPluginApp(
      fyersPlugin,
      decorateMongoWithToken(null),
    );
    await expect(app.ensureFyersSession()).resolves.toBe(false);
    await app.close();
  });

  it('verifyWithApi checks profile response', async () => {
    const app = await buildPluginApp(
      fyersPlugin,
      decorateMongoWithToken(makeJwt()),
    );
    (app.fyers.get_profile as jest.Mock).mockResolvedValue({
      s: ResponseStatus.ok,
      code: 200,
    });
    await expect(
      app.ensureFyersSession({ verifyWithApi: true }),
    ).resolves.toBe(true);
    await app.close();
  });
});