import { FyersAPI } from 'fyers-api-v3';
import { OptionType } from '../types/options';
import { TradingStyle } from '../types/trading-style';
import {
  buildGreeksStrikeInsight,
  buildGreeksStrikeInsightPair,
  formatThetaDecayLabel,
} from './greeks-moneyness-insight';

function chainWithGreeks(atm = 25000): FyersAPI.OptionChainData[] {
  const strikes = [atm - 100, atm, atm + 100];
  const rows: FyersAPI.OptionChainData[] = [];
  for (const strike of strikes) {
    for (const side of [OptionType.CE, OptionType.PE] as const) {
      rows.push({
        strike_price: strike,
        option_type: side,
        ltp: side === OptionType.CE ? 120 : 110,
        oi: 20000,
        oich: 1000,
        volume: 500,
        greeks: {
          delta: side === OptionType.CE ? 0.45 : -0.42,
          gamma: 0.02,
          theta: -4,
          vega: 8,
          iv: 18,
        },
      } as FyersAPI.OptionChainData);
    }
  }
  return rows;
}

describe('formatThetaDecayLabel', () => {
  it('hides near-zero decay', () => {
    expect(formatThetaDecayLabel(0, 65)).toBeNull();
    expect(formatThetaDecayLabel(0.001, 65)).toBeNull();
  });

  it('shows per-lot decay for realistic theta', () => {
    expect(formatThetaDecayLabel(-1.2, 65)).toBe('₹78.0/lot·day');
  });
});

describe('buildGreeksStrikeInsight', () => {
  it('builds ATM/ITM/OTM profiles for CE side', () => {
    const insight = buildGreeksStrikeInsight(
      chainWithGreeks(),
      25000,
      'CE',
      TradingStyle.Intraday,
      'Normal IV',
      'normal',
      { indexSymbol: 'NSE:NIFTY50-INDEX' },
    );
    expect(insight?.profiles.length).toBeGreaterThanOrEqual(2);
    expect(insight?.profiles.some((p) => p.moneyness === 'ATM')).toBe(true);
    expect(insight?.bestFit).toEqual(expect.any(String));
  });

  it('returns null for empty chain', () => {
    expect(
      buildGreeksStrikeInsight([], 25000, 'PE', TradingStyle.Scalper),
    ).toBeNull();
  });

  it('builds CE/PE pair', () => {
    const pair = buildGreeksStrikeInsightPair(
      chainWithGreeks(),
      25000,
      TradingStyle.Positional,
      'IV Crushed',
      { indexSymbol: 'NSE:NIFTY50-INDEX' },
    );
    expect(pair.CE?.optionSide).toBe('CE');
    expect(pair.PE?.optionSide).toBe('PE');
  });
});