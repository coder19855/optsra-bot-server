import Fastify, { FastifyInstance } from 'fastify';
import { ResponseStatus } from '../types/common';

export type MockFyers = {
  isTokenValid: jest.Mock;
  generateAuthCode: jest.Mock;
  generate_access_token: jest.Mock;
  setAccessToken: jest.Mock;
  logout_user: jest.Mock;
  get_profile: jest.Mock;
  get_funds: jest.Mock;
  getHistory: jest.Mock;
  getOptionChain: jest.Mock;
};

export function createMockFyers(
  overrides: Partial<MockFyers> = {},
): MockFyers {
  return {
    isTokenValid: jest.fn().mockResolvedValue(false),
    generateAuthCode: jest.fn().mockReturnValue('https://auth.fyers.example'),
    generate_access_token: jest.fn(),
    setAccessToken: jest.fn(),
    logout_user: jest.fn(),
    get_profile: jest.fn(),
    get_funds: jest.fn(),
    getHistory: jest.fn(),
    getOptionChain: jest.fn(),
    ...overrides,
  };
}

export function decorateFyers(
  fastify: FastifyInstance,
  fyers: MockFyers = createMockFyers(),
): MockFyers {
  fastify.decorate('fyers', fyers);
  return fyers;
}

export function decorateMongo(fastify: FastifyInstance) {
  const insertOne = jest.fn().mockResolvedValue({});
  const deleteMany = jest.fn().mockResolvedValue({});
  const findOne = jest.fn().mockResolvedValue(null);
  fastify.decorate('mongo', {
    client: {},
    ObjectId: class MockObjectId {},
    db: {
      collection: jest.fn().mockReturnValue({ insertOne, deleteMany, findOne }),
    },
  });
  return { insertOne, deleteMany, findOne };
}

/** Register a named fyers plugin stub (satisfies fastify plugin dependencies). */
export async function registerNamedFyersStub(
  fastify: FastifyInstance,
  fyers: MockFyers | Record<string, unknown> = createMockFyers(),
) {
  const fp = (await import('fastify-plugin')).default;
  await fastify.register(
    fp(
      async (instance) => {
        instance.decorate('fyers', fyers);
      },
      { name: 'fyers' },
    ),
  );
}

export function decorateTelegramNotifications(
  fastify: FastifyInstance,
  overrides: Partial<{
    isConfigured: boolean;
    getStatus: Record<string, unknown>;
  }> = {},
) {
  const sendMessage = jest.fn().mockResolvedValue(undefined);
  const pollNow = jest.fn().mockResolvedValue(undefined);
  const getStatus = jest
    .fn()
    .mockResolvedValue(overrides.getStatus ?? { enabled: true });
  fastify.decorate('telegramNotifications', {
    isConfigured: jest
      .fn()
      .mockReturnValue(overrides.isConfigured ?? true),
    isEnabled: jest.fn().mockReturnValue(true),
    sendMessage,
    pollNow,
    getStatus,
    resumeAlertsAfterLogin: jest.fn().mockResolvedValue(undefined),
    isAlertsPaused: jest.fn().mockReturnValue(false),
    setAlertsPaused: jest.fn().mockResolvedValue(undefined),
    startPolling: jest.fn(),
    stopPolling: jest.fn(),
  });
  return { sendMessage, pollNow, getStatus };
}

export function decorateFyersUsage(fastify: FastifyInstance) {
  fastify.decorate('fyersUsage', {
    record: jest.fn(),
    beginScope: jest.fn(),
    endScope: jest.fn(),
    getStats: jest.fn().mockReturnValue({ totalCalls: 0, scopes: {} }),
  });
}

export async function buildRouteApp(
  route: (fastify: FastifyInstance) => Promise<void>,
  setup?: (fastify: FastifyInstance) => void | Promise<void>,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  if (setup) await setup(app);
  await app.register(route);
  await app.ready();
  return app;
}

export async function buildPluginApp(
  plugin: Parameters<FastifyInstance['register']>[0],
  setup?: (fastify: FastifyInstance) => void | Promise<void>,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  if (setup) await setup(app);
  await app.register(plugin);
  await app.ready();
  return app;
}

export const okFundsResponse = {
  s: ResponseStatus.ok,
  code: 200,
  message: 'ok',
  fund_limit: [
    { title: 'Available Balance', equityAmount: 100000, commodityAmount: 0 },
    { title: 'Total Balance', equityAmount: 100000, commodityAmount: 0 },
  ],
};

export const okProfileResponse = {
  s: ResponseStatus.ok,
  code: 200,
  message: 'ok',
  data: { fy_id: 'TEST', name: 'Test User' },
};

export const errorFyersResponse = {
  s: ResponseStatus.error,
  code: 400,
  message: 'Upstream error',
};