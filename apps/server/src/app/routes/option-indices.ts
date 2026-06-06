import { FastifyInstance } from 'fastify';
import { FYERS_OPTION_INDEX_SYMBOLS } from '../constants/fyers-symbols';
import {
  OptionIndexExchange,
  OptionIndexSymbolsResponse,
} from '../types/fyers-symbols';

function parseExchangeFilter(value?: string): OptionIndexExchange | null {
  if (!value) return null;
  const normalized = value.toUpperCase();
  if (normalized === 'NSE' || normalized === 'BSE') {
    return normalized;
  }
  return null;
}

export default async function optionIndicesRoute(fastify: FastifyInstance) {
  fastify.get('/api/symbols/option-indices', async (request, reply) => {
    const { exchange } = request.query as { exchange?: string };
    const exchangeFilter = parseExchangeFilter(exchange);

    if (exchange && !exchangeFilter) {
      return reply.code(400).send({
        error: 'exchange must be NSE or BSE when provided',
      });
    }

    const indices: OptionIndexSymbolsResponse = exchangeFilter
      ? FYERS_OPTION_INDEX_SYMBOLS.filter(
          (item) => item.exchange === exchangeFilter,
        )
      : FYERS_OPTION_INDEX_SYMBOLS;

    reply.send(indices);
  });
}