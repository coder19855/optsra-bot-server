import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { fyersModel } from 'fyers-api-v3';

export default fp(
  async (fastify: FastifyInstance) => {
    const fyers = new fyersModel();

    fyers.initialize = async function () {
      const appId = process.env.FYERS_API_KEY || '';
      const redirectUrl = process.env.FYERS_REDIRECT_URL || '';

      if (appId) fyers.setAppId(appId);
      if (redirectUrl) fyers.setRedirectUrl(redirectUrl);
      if (await fyers.isTokenValid())
        fyers.setAccessToken(await fyers.getAccessToken());
    };

    fyers.getAccessToken = async function () {
      if (!fastify.mongo || !fastify.mongo.db) return '';

      const data = await fastify.mongo.db
        .collection('access-tokens')
        .findOne({}, { sort: { timestamp: -1 } });

      return data?.token || '';
    };

    fyers.isTokenValid = async function () {
      const token = await fyers.getAccessToken();

      if (!token) {
        return false;
      }

      try {
        // A JWT is split by dots: Header.Payload.Signature
        const payloadBase64 = token.split('.')[1];
        const decodedPayload = Buffer.from(payloadBase64, 'base64').toString(
          'utf-8',
        );
        const payload = JSON.parse(decodedPayload);

        if (payload.exp) {
          return Date.now() < payload.exp * 1000;
        }
        return false;
      } catch (error) {
        console.error('Error validating token:', error);
        return false;
      }
    };

    // Add a hook to run initialization for all /api routes automatically
    fastify.addHook('onRequest', async (request) => {
      if (request.url.startsWith('/api')) {
        await fyers.initialize();
      }
    });

    fastify.decorate('fyers', fyers);
  },
  { name: 'fyers' },
);
