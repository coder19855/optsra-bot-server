import profileRoute from './profile';
import { ResponseStatus } from '../types/common';
import {
  buildRouteApp,
  createMockFyers,
  decorateFyers,
  okProfileResponse,
  errorFyersResponse,
} from '../testing/fastify-test-harness';

describe('GET /api/profile', () => {
  it('returns profile data on success', async () => {
    const fyers = createMockFyers({
      get_profile: jest.fn().mockResolvedValue(okProfileResponse),
    });
    const app = await buildRouteApp(profileRoute, (f) => decorateFyers(f, fyers));
    const res = await app.inject({ method: 'GET', url: '/api/profile' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      message: 'Profile retrieved successfully',
      data: okProfileResponse.data,
    });
    await app.close();
  });

  it('returns upstream error on failure', async () => {
    const fyers = createMockFyers({
      get_profile: jest.fn().mockResolvedValue(errorFyersResponse),
    });
    const app = await buildRouteApp(profileRoute, (f) => decorateFyers(f, fyers));
    const res = await app.inject({ method: 'GET', url: '/api/profile' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Upstream error' });
    await app.close();
  });
});