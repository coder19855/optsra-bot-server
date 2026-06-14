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

  it('includes reportId for cached visual opens', () => {
    const url = buildBenchmarkWebAppUrl({
      reportId: 'abc123',
      symbol: 'NSE:NIFTY50-INDEX',
      tradingStyle: 'INTRADAY',
      days: 14,
    });
    expect(url).toContain('reportId=abc123');
    expect(url).toContain('days=14');
  });

  it('includes jobId for async progress polling', () => {
    const url = buildBenchmarkWebAppUrl({
      jobId: 'job456',
      symbol: 'NSE:NIFTY50-INDEX',
      tradingStyle: 'INTRADAY',
      days: 30,
      aiMode: 'shadow',
      maxTradesPerDay: 2,
    });
    expect(url).toContain('jobId=job456');
    expect(url).toContain('symbol=NSE%3ANIFTY50-INDEX');
    expect(url).toContain('days=30');
    expect(url).toContain('maxTrades=2');
  });
});