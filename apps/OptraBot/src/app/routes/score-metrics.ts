import { HttpStatusCode } from 'axios';
import { FastifyInstance } from 'fastify';
import { ResponseStatus } from '../types';
import { ScoreComponents } from '../fastify';

export default async function scoreboardRoutes(fastify: FastifyInstance) {
  fastify.get('/api/score-metrics', async (request, reply) => {
    const { symbol, strikeCount } = request.query as {
      symbol: string;
      strikeCount?: number;
    };

    const updatedStrikeCount = +(strikeCount || 10);

    try {
      const response = await fastify.fyers.getOptionChain({
        symbol,
        strikecount: updatedStrikeCount,
        timestamp: '',
        greeks: 1,
      });

      if (response.s === ResponseStatus.ok) {
        const { optionsChain, indiavixData } = response.data;
        const [spotData, ...optionChainWithoutSpot] = optionsChain;

        const {
          ltp: spotLtp,
          symbol: spotSymbol,
          ltpch: spotLtpChange,
          ltpchp: spotLtpChangePercent,
        } = spotData || {};

        // Filter the chain to +/- 5 strikes around ATM to remove deep OTM noise
        const filteredChain =
          fastify.metricCalculationPlugin.filterNearbyStrikes(
            optionChainWithoutSpot,
            spotLtp || 0,
            updatedStrikeCount,
          );

        const components: ScoreComponents = {
          oi: fastify.metricCalculationPlugin.calcOiPressure(
            filteredChain,
            spotLtp || 0,
          ),
          pcr: fastify.metricCalculationPlugin.calcPcrScore(
            optionChainWithoutSpot,
          ),
          skew: fastify.metricCalculationPlugin.calcSkewScore(
            optionChainWithoutSpot, // Skew requires finding 25-delta strikes (often 8-12 strikes away)
          ),
          iv: fastify.metricCalculationPlugin.calcAtmIvScore(
            filteredChain,
            spotLtp || 0,
          ),
          pain: fastify.metricCalculationPlugin.calcMaxPainScore(
            optionChainWithoutSpot,
            spotLtp || 0,
          ),
          greeks: fastify.metricCalculationPlugin.calcGreeksScore(
            filteredChain,
            spotLtp || 0,
          ),
          vix: fastify.metricCalculationPlugin.calcVixScore(
            indiavixData.ltp || 0,
          ),
          trend: fastify.metricCalculationPlugin.calcTrendConfirmationScore(
            optionChainWithoutSpot,
            spotLtpChangePercent || 0,
          ),
        };

        const score = fastify.utilsPlugin.calcFinalScore(components);
        const { bias, strategies } =
          fastify.strategyMapperPlugin.mapStrategiesWithVix(
            score,
            indiavixData.ltp || 0,
            components,
          );
        const signal = fastify.utilsPlugin.mapSignal(score);
        const levels = fastify.supportResistancePlugin.getSupportResistance(
          optionChainWithoutSpot,
        );
        const explanations = fastify.explanationPlugin.buildExplanations(
          components,
          indiavixData.ltp || 0,
        );
        const confidence = fastify.utilsPlugin.computeConfidence(
          explanations,
          signal,
        );

        const ivRegime = fastify.utilsPlugin.detectIvRegime(
          components.iv || 0,
          components.vix,
          components.skew || 0,
        );

        reply.send({
          spotSymbol,
          spotLtp,
          spotLtpChange,
          spotLtpChangePercent,
          score,
          bias,
          ivRegime,
          signal,
          confidence,
          strategies,
          levels,
          explanations,
        });
      } else {
        reply.code(response.code).send({ error: response.message });
      }
    } catch (error) {
      reply.status(HttpStatusCode.InternalServerError).send({ error });
    }
  });
}
