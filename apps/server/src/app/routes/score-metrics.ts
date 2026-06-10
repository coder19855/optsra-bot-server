import { HttpStatusCode } from 'axios';
import { FastifyInstance } from 'fastify';
import { buildGreeksStrikeInsightPair } from '../option-flow/greeks-moneyness-insight';
import { ResponseStatus } from '../types';
import type { ScoreComponents } from '../fastify';
import { TradingStyle } from '../trading-style';

export default async function scoreboardRoutes(fastify: FastifyInstance) {
  fastify.get('/api/score-metrics', async (request, reply) => {
    const { symbol, strikeCount, tradingStyle } = request.query as {
      symbol: string;
      strikeCount?: number;
      tradingStyle?: string;
    };

    const updatedStrikeCount = +(strikeCount || 10);

    // Parse trading style (default to INTRADAY for a reasonable intraday tilt)
    const styleStr = (tradingStyle || 'INTRADAY').toUpperCase();
    let activeStyle = TradingStyle.Intraday;
    if (styleStr === 'SCALPER' || styleStr === TradingStyle.Scalper) {
      activeStyle = TradingStyle.Scalper;
    } else if (styleStr === 'POSITIONAL' || styleStr === TradingStyle.Positional) {
      activeStyle = TradingStyle.Positional;
    }

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

        // Filter the chain to +/- strikes around ATM to remove deep OTM noise.
        // For SCALPER we lean harder on the local/near-ATM cluster for most metrics.
        const filteredChain =
          fastify.metricCalculationPlugin.filterNearbyStrikes(
            optionChainWithoutSpot,
            spotLtp || 0,
            updatedStrikeCount,
          );

        const isScalper = activeStyle === TradingStyle.Scalper;
        const trendSensitivity = isScalper ? 'aggressive' : 'normal';

        // For scalper we use the filtered (local) chain for pcr/pain/trend to focus on active strikes
        // rather than the whole chain (which includes far OTM that moves slower / is noisier for intraday).
        const pcrSource = isScalper ? filteredChain : optionChainWithoutSpot;
        const painSource = isScalper ? filteredChain : optionChainWithoutSpot;
        const trendSource = isScalper ? filteredChain : optionChainWithoutSpot;

        const components: ScoreComponents = {
          oi: fastify.metricCalculationPlugin.calcOiPressure(
            filteredChain,
            spotLtp || 0,
          ),
          pcr: fastify.metricCalculationPlugin.calcPcrScore(pcrSource),
          skew: fastify.metricCalculationPlugin.calcSkewScore(
            optionChainWithoutSpot, // Keep skew on wider chain — it is a structural fear/greed gauge
          ),
          iv: fastify.metricCalculationPlugin.calcAtmIvScore(
            filteredChain,
            spotLtp || 0,
          ),
          pain: fastify.metricCalculationPlugin.calcMaxPainScore(
            painSource,
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
            trendSource,
            spotLtpChangePercent || 0,
            trendSensitivity,
          ),
        };

        const score = fastify.utilsPlugin.calcFinalScore(components, activeStyle);
        const { bias, strategies } =
          fastify.strategyMapperPlugin.mapStrategiesWithVix(
            score,
            indiavixData.ltp || 0,
            components,
            activeStyle,
          );
        const signal = fastify.utilsPlugin.mapSignal(score, activeStyle);
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

        const greeksStrikeInsights = buildGreeksStrikeInsightPair(
          filteredChain,
          spotLtp || 0,
          activeStyle,
          ivRegime,
          'normal',
          { indexSymbol: symbol, expiryData: response.data.expiryData },
        );

        reply.send({
          spotSymbol,
          spotLtp,
          spotLtpChange,
          spotLtpChangePercent,
          tradingStyle: activeStyle,
          score,
          bias,
          ivRegime,
          signal,
          confidence,
          strategies,
          levels,
          explanations,
          // Clean components for the decision engine / brain
          components: {
            oi: components.oi,
            pcr: components.pcr,
            skew: components.skew,
            iv: components.iv,
            pain: components.pain,
            greeks: components.greeks,
            vix: components.vix,
            trend: components.trend,
          },
          greeksStrikeInsights,
          optionChainNearby: filteredChain,
        });
      } else {
        reply.code(response.code).send({ error: response.message });
      }
    } catch (error) {
      reply.status(HttpStatusCode.InternalServerError).send({ error });
    }
  });
}
