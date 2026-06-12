import {
  DECK_STREAM_DEFAULTS,
  resolveDeckSseEnabled,
  resolveDeckStreamFullRefreshMs,
  resolveDeckStreamTickMs,
} from './deck-stream';

describe('deck-stream constants', () => {
  const env = process.env;

  beforeEach(() => {
    process.env = { ...env };
  });

  afterAll(() => {
    process.env = env;
  });

  it('uses default tick and full refresh intervals', () => {
    delete process.env.DECK_SSE_TICK_MS;
    delete process.env.DECK_FULL_REFRESH_MS;
    expect(resolveDeckStreamTickMs()).toBe(
      DECK_STREAM_DEFAULTS.TICK_INTERVAL_MS,
    );
    expect(resolveDeckStreamFullRefreshMs()).toBe(
      DECK_STREAM_DEFAULTS.FULL_REFRESH_MS,
    );
  });

  it('parses positive env overrides', () => {
    process.env.DECK_SSE_TICK_MS = '5000';
    process.env.DECK_FULL_REFRESH_MS = '120000';
    expect(resolveDeckStreamTickMs()).toBe(5000);
    expect(resolveDeckStreamFullRefreshMs()).toBe(120_000);
  });

  it('enables SSE by default and respects disable flag', () => {
    delete process.env.DECK_SSE_ENABLED;
    expect(resolveDeckSseEnabled()).toBe(true);
    process.env.DECK_SSE_ENABLED = 'false';
    expect(resolveDeckSseEnabled()).toBe(false);
  });
});