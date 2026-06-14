import { buildBenchmarkWebAppUrl } from './deck-url';

describe('buildBenchmarkWebAppUrl', () => {
  const prev = process.env.PUBLIC_APP_URL;

  beforeEach(() => {
    process.env.PUBLIC_APP_URL = 'https://bot.example.com';
  });

  afterEach(() => {
    if (prev == null) delete process.env.PUBLIC_APP_URL;
    else process.env.PUBLIC_APP_URL = prev;
  });

  it('prefers reportId for cached visual opens', () => {
    const url = buildBenchmarkWebAppUrl({
      reportId: 'abc123',
      symbol: 'NSE:NIFTY50-INDEX',
      tradingStyle: 'INTRADAY',
    });
    expect(url).toBe('https://bot.example.com/benchmark/?reportId=abc123');
  });

  it('encodes live-run query params when no reportId', () => {
    const url = buildBenchmarkWebAppUrl({
      symbol: 'NSE:NIFTY50-INDEX',
      tradingStyle: 'INTRADAY',
      days: 30,
      aiMode: 'shadow',
      maxTradesPerDay: 2,
    });
    expect(url).toContain('symbol=NSE%3ANIFTY50-INDEX');
    expect(url).toContain('days=30');
    expect(url).toContain('maxTrades=2');
  });
});