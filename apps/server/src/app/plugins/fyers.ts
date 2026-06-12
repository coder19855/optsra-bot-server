import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { fyersModel } from 'fyers-api-v3';
import { ResponseStatus } from '../types/common';

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

      const col = fastify.mongo.db.collection<{
        _id?: string;
        token: string;
        timestamp: number;
      }>('access-tokens');
      const data =
        (await col.findOne({ _id: 'latest' })) ??
        (await col.findOne({}, { sort: { timestamp: -1 } }));

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

    /** Load app id + access token from Mongo onto the Fyers client (required before REST calls). */
    async function ensureFyersSession(options?: {
      verifyWithApi?: boolean;
    }): Promise<boolean> {
      await fyers.initialize();
      if (!(await fyers.isTokenValid())) return false;

      if (options?.verifyWithApi) {
        try {
          const response = await fyers.get_profile();
          return response.s === ResponseStatus.ok;
        } catch (error) {
          console.error('Fyers API session verification failed:', error);
          return false;
        }
      }

      return true;
    }

    // HTTP /api routes auto-initialize; Telegram commands and background jobs must call ensureFyersSession().
    fastify.addHook('onRequest', async (request) => {
      if (request.url.startsWith('/api')) {
        await ensureFyersSession();
      }
    });

    fastify.decorate('fyers', fyers);
    fastify.decorate('ensureFyersSession', ensureFyersSession);
  },
  { name: 'fyers' },
);
