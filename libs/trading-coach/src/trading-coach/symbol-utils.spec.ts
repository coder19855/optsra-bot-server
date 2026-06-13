import { parseStrikeFromFyersOptionSymbol } from './symbol-utils';

describe('parseStrikeFromFyersOptionSymbol', () => {
  it('parses Nifty weekly symbols', () => {
    expect(parseStrikeFromFyersOptionSymbol('NSE:NIFTY2661623200CE')).toBe(
      23200,
    );
    expect(parseStrikeFromFyersOptionSymbol('NSE:NIFTY2661623150PE')).toBe(
      23150,
    );
  });

  it('parses Bank Nifty symbols', () => {
    expect(parseStrikeFromFyersOptionSymbol('NSE:NIFTYBANK2661256000CE')).toBe(
      56000,
    );
  });

  it('returns null for non-option symbols', () => {
    expect(parseStrikeFromFyersOptionSymbol('NSE:NIFTY50-INDEX')).toBeNull();
    expect(parseStrikeFromFyersOptionSymbol('')).toBeNull();
  });
});