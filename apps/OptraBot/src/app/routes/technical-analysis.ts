import { FastifyInstance } from 'fastify';
import { HttpStatusCode } from 'axios';
import { FyersAPI } from 'fyers-api-v3';
import { ResponseStatus } from '../types';

export default async function priceActionRoute(fastify: FastifyInstance) {
  fastify.get('/api/technical-analysis', async (request, reply) => {
    try {
      const { symbol, range_to } =
        request.query as FyersAPI.HistoryQueryRequest;

      const MS_PER_DAY = 24 * 60 * 60 * 1000;
      const toEpochSeconds = (ms: number) => Math.floor(ms / 1000).toString();

      // Normalize input to milliseconds (handle both seconds and ms inputs)
      let rangeTo = +range_to || Date.now();
      if (rangeTo < 10000000000) rangeTo *= 1000;

      const formattedRangeTo = toEpochSeconds(rangeTo);
      const rangeFrom = toEpochSeconds(rangeTo - 10 * MS_PER_DAY);

      const cont_flag = 1;
      const oi_flag = 0;
      const date_format = 0;

      const responseFor5Min = await fastify.fyers.getHistory({
        symbol,
        resolution: '5',
        range_from: rangeFrom,
        range_to: formattedRangeTo,
        cont_flag,
        oi_flag,
        date_format,
      });

      const responseFor15Min = await fastify.fyers.getHistory({
        symbol,
        resolution: '15',
        range_from: rangeFrom,
        range_to: formattedRangeTo,
        cont_flag,
        oi_flag,
        date_format,
      });

      const responseFor1hr = await fastify.fyers.getHistory({
        symbol,
        resolution: '60',
        range_from: rangeFrom,
        range_to: formattedRangeTo,
        cont_flag,
        oi_flag,
        date_format,
      });

      if (
        responseFor5Min.s === ResponseStatus.ok &&
        responseFor15Min.s === ResponseStatus.ok &&
        responseFor1hr.s === ResponseStatus.ok
      ) {
        // Calculate Swing for all 3 time frames
        const swings5m = fastify.priceActionPlugin.getSwings(
          responseFor5Min.candles,
        );
        const swings15m = fastify.priceActionPlugin.getSwings(
          responseFor15Min.candles,
        );
        const swings1hr = fastify.priceActionPlugin.getSwings(
          responseFor1hr.candles,
        );

        // Calculate Market structure
        const marketStructure5m =
          fastify.priceActionPlugin.getMarketStructure(swings5m);
        const marketStructure15m =
          fastify.priceActionPlugin.getMarketStructure(swings15m);
        const marketStructure1hr =
          fastify.priceActionPlugin.getMarketStructure(swings1hr);

        // Calculate Support and Resistance
        const supportAndResistance5m =
          fastify.priceActionPlugin.getSupportAndResistance(swings5m);
        const supportAndResistance15m =
          fastify.priceActionPlugin.getSupportAndResistance(swings15m);
        const supportAndResistance1hr =
          fastify.priceActionPlugin.getSupportAndResistance(swings1hr);

        // Detect breakout
        const breakout5m = fastify.priceActionPlugin.detectBreakout(
          responseFor5Min.candles,
          supportAndResistance5m.support,
          supportAndResistance5m.resistance,
        );
        const breakout15m = fastify.priceActionPlugin.detectBreakout(
          responseFor15Min.candles,
          supportAndResistance15m.support,
          supportAndResistance15m.resistance,
        );
        const breakout1hr = fastify.priceActionPlugin.detectBreakout(
          responseFor1hr.candles,
          supportAndResistance1hr.support,
          supportAndResistance1hr.resistance,
        );

        // Detect Fakeout
        const fakeout5m = fastify.priceActionPlugin.detectFakeout(
          responseFor5Min.candles,
          supportAndResistance5m.support,
          supportAndResistance5m.resistance,
        );
        const fakeout15m = fastify.priceActionPlugin.detectFakeout(
          responseFor15Min.candles,
          supportAndResistance15m.support,
          supportAndResistance15m.resistance,
        );
        const fakeout1hr = fastify.priceActionPlugin.detectFakeout(
          responseFor1hr.candles,
          supportAndResistance1hr.support,
          supportAndResistance1hr.resistance,
        );

        // Detect Retest
        const retest5m = fastify.priceActionPlugin.detectRetest(
          responseFor5Min.candles,
          supportAndResistance5m.support,
          supportAndResistance5m.resistance,
        );
        const retest15m = fastify.priceActionPlugin.detectRetest(
          responseFor15Min.candles,
          supportAndResistance15m.support,
          supportAndResistance15m.resistance,
        );
        const retest1hr = fastify.priceActionPlugin.detectRetest(
          responseFor1hr.candles,
          supportAndResistance1hr.support,
          supportAndResistance1hr.resistance,
        );

        // Calculate Volume
        const volume5m = fastify.priceActionPlugin.volumeScore(
          responseFor5Min.candles,
        );
        const volume15m = fastify.priceActionPlugin.volumeScore(
          responseFor15Min.candles,
        );
        const volume1hr = fastify.priceActionPlugin.volumeScore(
          responseFor1hr.candles,
        );

        // trend bias
        const trendBias5m = fastify.priceActionPlugin.swingTrendBias(swings5m);
        const trendBias15m =
          fastify.priceActionPlugin.swingTrendBias(swings15m);
        const trendBias1hr =
          fastify.priceActionPlugin.swingTrendBias(swings1hr);

        const score5m = fastify.priceActionPlugin.scoreTimeFrameContext({
          structure: marketStructure5m,
          breakout: breakout5m,
          retest: retest5m,
          volume: volume5m,
          fakeout: fakeout5m,
          trendBias: trendBias5m,
        });

        const score15m = fastify.priceActionPlugin.scoreTimeFrameContext({
          structure: marketStructure15m,
          breakout: breakout15m,
          retest: retest15m,
          volume: volume15m,
          fakeout: fakeout15m,
          trendBias: trendBias15m,
        });

        const score1hr = fastify.priceActionPlugin.scoreTimeFrameContext({
          structure: marketStructure1hr,
          breakout: breakout1hr,
          retest: retest1hr,
          volume: volume1hr,
          fakeout: fakeout1hr,
          trendBias: trendBias1hr,
        });

        const score = fastify.priceActionPlugin.getMultiTimeFrameScore({
          score5m,
          score15m,
          score1hr,
        });
        const recommendation =
          fastify.priceActionPlugin.getTradeRecommendationFromScore(score);

        const isBullishTransition =
          fastify.priceActionPlugin.isBullishTransition({
            score5m,
            score15m,
            score1hr,
            finalMTF: score,
          });

        const isBearishTransition =
          fastify.priceActionPlugin.isBearishTransition({
            score5m,
            score15m,
            score1hr,
            finalMTF: score,
          });

        const isBullishTrendStart =
          fastify.priceActionPlugin.isBullishTrendStart({
            score5m,
            score15m,
            score1hr,
            finalMTF: score,
          });

        const isBullishTrendExhaustion =
          fastify.priceActionPlugin.isBullishTrendExhaustion(
            {
              score5m,
              score15m,
              score1hr,
              finalMTF: score,
            },
            volume5m,
          );

        const isBearishTrendStart =
          fastify.priceActionPlugin.isBearishTrendStart({
            score5m,
            score15m,
            score1hr,
            finalMTF: score,
          });

        const isBullishFakeReversal =
          fastify.priceActionPlugin.isBullishFakeReversal(
            {
              score5m,
              score15m,
              score1hr,
              finalMTF: score,
            },
            volume5m,
            fakeout5m,
          );

        const isBearishFakeReversal =
          fastify.priceActionPlugin.isBearishFakeReversal(
            {
              score5m,
              score15m,
              score1hr,
              finalMTF: score,
            },
            volume5m,
            fakeout5m,
          );

        const isBearishTrendExhaustion =
          fastify.priceActionPlugin.isBearishTrendExhaustion(
            {
              score5m,
              score15m,
              score1hr,
              finalMTF: score,
            },
            volume5m,
          );

        const biasSignal = fastify.priceActionPlugin.getBiasSignalFromPatterns({
          isBullishTrendStart,
          isBearishTrendStart,
          isBullishTransition,
          isBearishTransition,
          isBullishTrendExhaustion,
          isBearishTrendExhaustion,
          isBullishFakeReversal,
          isBearishFakeReversal,
        });

        reply.send({
          symbol,
          priceAction: {
            score,
            recommendation,
            biasSignal,
            timeFrames: {
              score: {
                '5min': score5m,
                '15min': score15m,
                '1hr': score1hr,
              },
              swing: {
                '5min': swings5m,
                '15min': swings15m,
                '1hr': swings1hr,
              },
              marketStructure: {
                '5min': marketStructure5m,
                '15min': marketStructure15m,
                '1hr': marketStructure1hr,
              },
              supportAndResistance: {
                '5min': supportAndResistance5m,
                '15min': supportAndResistance15m,
                '1hr': supportAndResistance1hr,
              },
              breakout: {
                '5min': breakout5m,
                '15min': breakout15m,
                '1hr': breakout1hr,
              },
              fakeout: {
                '5min': fakeout5m,
                '15min': fakeout15m,
                '1hr': fakeout1hr,
              },
              volume: {
                '5min': volume5m,
                '15min': volume15m,
                '1hr': volume1hr,
              },
              retest: {
                '5min': retest5m,
                '15min': retest15m,
                '1hr': retest1hr,
              },
            },
          },
        });
      } else {
        reply
          .code(HttpStatusCode.BadRequest)
          .send({ error: responseFor5Min.message });
      }
    } catch (error) {
      reply.status(HttpStatusCode.InternalServerError).send({ error });
    }
  });
}
