import { TradingStyle } from '../types/trading-style';
import { parseStyleCommandArgs } from './style-command';

describe('style-command', () => {
  it('parses style intraday/scalper/positional/status', () => {
    expect(parseStyleCommandArgs('/style')).toEqual({ action: 'status' });
    expect(parseStyleCommandArgs('/style status')).toEqual({ action: 'status' });
    expect(parseStyleCommandArgs('/style intraday')).toEqual({
      action: TradingStyle.Intraday,
    });
    expect(parseStyleCommandArgs('/style scalper')).toEqual({
      action: TradingStyle.Scalper,
    });
    expect(parseStyleCommandArgs('/style positional')).toEqual({
      action: TradingStyle.Positional,
    });
    expect(parseStyleCommandArgs('/style scalp')).toEqual({
      action: TradingStyle.Scalper,
    });
    expect(parseStyleCommandArgs('/style swing')).toEqual({
      action: TradingStyle.Positional,
    });
  });
});