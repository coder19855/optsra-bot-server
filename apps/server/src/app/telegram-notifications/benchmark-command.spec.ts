import { TradingStyle } from '../types/trading-style';
import {
  formatBenchmarkHelpMessage,
  isBenchmarkHelpRequest,
  parseBenchmarkCommandArgs,
} from './benchmark-command';

describe('benchmark command help', () => {
  it('treats bare /benchmark as help', () => {
    expect(isBenchmarkHelpRequest('/benchmark')).toBe(true);
    expect(isBenchmarkHelpRequest('/benchmark@MyBot')).toBe(true);
    expect(isBenchmarkHelpRequest('/backtest')).toBe(true);
    expect(isBenchmarkHelpRequest('/benchmark help')).toBe(true);
    expect(isBenchmarkHelpRequest('/benchmark options')).toBe(true);
  });

  it('runs when days or options are provided', () => {
    expect(isBenchmarkHelpRequest('/benchmark 14')).toBe(false);
    expect(isBenchmarkHelpRequest('/benchmark 30 2')).toBe(false);
    expect(isBenchmarkHelpRequest('/benchmark ai-off')).toBe(false);
    expect(isBenchmarkHelpRequest('/benchmark NIFTY 30')).toBe(false);
  });

  it('formats help with watchlist defaults', () => {
    const msg = formatBenchmarkHelpMessage({
      symbol: 'NSE:NIFTY50-INDEX',
      style: TradingStyle.Intraday,
      vetoMode: 'strict',
      flowMode: 'blend',
    });
    expect(msg).toContain('NIFTY50');
    expect(msg).toContain('Intraday');
    expect(msg).toContain('/benchmark 30 2');
    expect(msg).not.toContain('[object Object]');
  });

  it('still parses args when not help', () => {
    const parsed = parseBenchmarkCommandArgs('/benchmark 30 2 ai-shadow', {
      symbol: 'NSE:NIFTY50-INDEX',
      style: TradingStyle.Intraday,
    });
    expect(parsed.days).toBe(30);
    expect(parsed.maxTradesPerDay).toBe(2);
    expect(parsed.aiMode).toBe('shadow');
  });

  it('normalizes shorthand watchlist symbol for /benchmark 30', () => {
    const parsed = parseBenchmarkCommandArgs('/benchmark 30', {
      symbol: 'NIFTY50',
      style: TradingStyle.Intraday,
    });
    expect(parsed.symbol).toBe('NSE:NIFTY50-INDEX');
  });

  it('parses intraday style without stripping it as an ai token', () => {
    const parsed = parseBenchmarkCommandArgs(
      '/benchmark NIFTY50 intraday 30 ai-shadow',
      {
        symbol: 'NSE:NIFTY50-INDEX',
        style: TradingStyle.Scalper,
      },
    );
    expect(parsed.symbol).toBe('NSE:NIFTY50-INDEX');
    expect(parsed.style).toBe(TradingStyle.Intraday);
    expect(parsed.days).toBe(30);
    expect(parsed.aiMode).toBe('shadow');
  });
});