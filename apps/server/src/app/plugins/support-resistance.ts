import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { FyersAPI } from 'fyers-api-v3';

export default fp(async (fastify: FastifyInstance) => {
  const getHighestPutOI = (chain: FyersAPI.OptionChainData[]) => {
    const puts = chain.filter((r) => r.option_type === 'PE');
    if (puts.length === 0) return null;
    return puts.reduce((a, b) => (b.oi > a.oi ? b : a)).strike_price;
  };

  const getHighestCallOI = (chain: FyersAPI.OptionChainData[]) => {
    const calls = chain.filter((r) => r.option_type === 'CE');
    if (calls.length === 0) return null;
    return calls.reduce((a, b) => (b.oi > a.oi ? b : a)).strike_price;
  };

  const getIntradayPutSupport = (chain: FyersAPI.OptionChainData[]) => {
    const puts = chain.filter((r) => r.option_type === 'PE');
    if (puts.length === 0) return null;
    return puts
      .map((r) => ({ strike: r.strike_price, dOI: r.oich }))
      .reduce((a, b) => (b.dOI > a.dOI ? b : a)).strike;
  };

  const getIntradayCallResistance = (chain: FyersAPI.OptionChainData[]) => {
    const calls = chain.filter((r) => r.option_type === 'CE');
    if (calls.length === 0) return null;
    return calls
      .map((r) => ({ strike: r.strike_price, dOI: r.oich }))
      .reduce((a, b) => (b.dOI > a.dOI ? b : a)).strike;
  };

  const getSupportResistance = (chain: FyersAPI.OptionChainData[]) => {
    return {
      overallSupport: getHighestPutOI(chain),
      overallResistance: getHighestCallOI(chain),
      intradaySupport: getIntradayPutSupport(chain),
      intradayResistance: getIntradayCallResistance(chain),
    };
  };

  const supportResistancePlugin = {
    getSupportResistance,
  };

  fastify.decorate('supportResistancePlugin', supportResistancePlugin);
});
