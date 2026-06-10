import { fyersModel } from 'fyers-api-v3';
import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { FYERS_TRACKED_METHODS, FyersTrackedMethod } from '../constants/fyers-usage';
import { FyersUsageTracker } from '../fyers-usage/tracker';
import { FyersUsageResponse } from '../types/fyers-usage';

function asMutableFyers(fyers: fyersModel): Record<string, unknown> {
  return fyers as unknown as Record<string, unknown>;
}

function wrapTrackedMethods(
  fyers: fyersModel,
  tracker: FyersUsageTracker,
): void {
  const target = asMutableFyers(fyers);
  for (const methodName of FYERS_TRACKED_METHODS) {
    const original = target[methodName];
    if (typeof original !== 'function') continue;

    target[methodName] = function wrappedFyersCall(
      this: fyersModel,
      ...args: unknown[]
    ) {
      tracker.record(methodName as FyersTrackedMethod);
      return (original as (...a: unknown[]) => unknown).apply(this, args);
    };
  }
}

export default fp(
  async (fastify: FastifyInstance) => {
    const tracker = new FyersUsageTracker();
    wrapTrackedMethods(fastify.fyers, tracker);

    fastify.decorate('fyersUsage', {
      record: (method: FyersTrackedMethod) => tracker.record(method),
      beginScope: (scope: string) => tracker.beginScope(scope),
      endScope: (scope: string) => tracker.endScope(scope),
      getStats: (): FyersUsageResponse => tracker.getStats(),
    });
  },
  {
    name: 'fyers-usage',
    dependencies: ['fyers'],
  },
);