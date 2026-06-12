import { fyersModel, FyersAPI } from 'fyers-api-v3';
import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { getMarketDataStore } from '../market-data/market-data-store';

function asMutableFyers(fyers: fyersModel): Record<string, unknown> {
  return fyers as unknown as Record<string, unknown>;
}

export default fp(
  async (fastify: FastifyInstance) => {
    const store = getMarketDataStore();
    const target = asMutableFyers(fastify.fyers);

    const originalGetHistory = target.getHistory;
    if (typeof originalGetHistory === 'function') {
      target.getHistory = function wrappedGetHistory(
        this: fyersModel,
        ...args: unknown[]
      ) {
        const params = args[0] as FyersAPI.HistoryQueryRequest;
        return store.getHistory(params, () =>
          (
            originalGetHistory as (
              ...a: [FyersAPI.HistoryQueryRequest]
            ) => Promise<FyersAPI.HistoryResponse>
          ).apply(this, [params]),
        );
      };
    }

    const originalGetOptionChain = target.getOptionChain;
    if (typeof originalGetOptionChain === 'function') {
      target.getOptionChain = function wrappedGetOptionChain(
        this: fyersModel,
        ...args: unknown[]
      ) {
        const params = args[0] as FyersAPI.OptionChainRequest;
        return store.getOptionChain(params, () =>
          (
            originalGetOptionChain as (
              ...a: [FyersAPI.OptionChainRequest]
            ) => Promise<FyersAPI.OptionChainResponse>
          ).apply(this, [params]),
        );
      };
    }

    fastify.decorate('marketDataCache', {
      getStats: () => store.getStats(),
    });
  },
  {
    name: 'market-data-cache',
    dependencies: ['fyers-usage'],
  },
);