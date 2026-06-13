import { FyersAPI } from 'fyers-api-v3';
import { OptionType } from '../types/options';
import { TradingStyle } from '../types/trading-style';
import { GreeksStrikeInsight } from '../types/greeks-strike-insight';
import {
  buildExactStrikeRecommendation,
  buildExactStrikeRecommendationPair,
} from './exact-strike-recommender';

function chainRow(
  strike: number,
  side: 'CE' | 'PE',
  ltp: number,
): FyersAPI.OptionChainData {
  return {
    strike_price: strike,
    option_type: side === 'CE' ? OptionType.CE : OptionType.PE,
    ltp,
    symbol: `NSE:NIFTY${strike}${side}`,
    oi: 1000,
    oich: 100,
    volume: 50,
  } as FyersAPI.OptionChainData;
}

const greeksInsight: GreeksStrikeInsight = {
  optionSide: 'CE',
  profiles: [
    {
      moneyness: 'ATM',
      strike: 25000,
      premium: 120,
      delta: 0.45,
      gamma: 0.02,
      theta: -5,
      gammaLevel: 'moderate',
      thetaLabel: null,
      consequence: 'Balanced',
    },
    {
      moneyness: 'ITM',
      strike: 24900,
      premium: 180,
      delta: 0.62,
      gamma: 0.01,
      theta: -4,
      gammaLevel: 'low',
      thetaLabel: null,
      consequence: 'Safer',
    },
  ],
  bestFit: 'ATM for intraday',
  ivNote: null,
};

describe('exact-strike-recommender', () => {
  it('returns null without greeks profiles', () => {
    expect(
      buildExactStrikeRecommendation(
        [chainRow(25000, 'CE', 120)],
        'NSE:NIFTY50-INDEX',
        'CE',
        TradingStyle.Intraday,
        60,
        null,
        'Normal IV',
        false,
      ),
    ).toBeNull();
  });

  it('picks ATM strike for intraday with sufficient conviction', () => {
    const chain = [chainRow(25000, 'CE', 125)];
    const rec = buildExactStrikeRecommendation(
      chain,
      'NSE:NIFTY50-INDEX',
      'CE',
      TradingStyle.Intraday,
      72,
      greeksInsight,
      'Normal IV',
      false,
    );
    expect(rec).toMatchObject({
      strike: 25000,
      moneyness: 'ATM',
      premium: 125,
      lotSize: expect.any(Number),
    });
    expect(rec?.rationale).toContain('ATM');
  });

  it('picks ITM when below style threshold', () => {
    const chain = [chainRow(24900, 'CE', 180)];
    const rec = buildExactStrikeRecommendation(
      chain,
      'NSE:NIFTY50-INDEX',
      'CE',
      TradingStyle.Intraday,
      40,
      greeksInsight,
      'Normal IV',
      true,
    );
    expect(rec?.moneyness).toBe('ITM');
    expect(rec?.strike).toBe(24900);
  });

  it('builds CE/PE pair', () => {
    const chain = [
      chainRow(25000, 'CE', 120),
      chainRow(25000, 'PE', 110),
    ];
    const pair = buildExactStrikeRecommendationPair(
      chain,
      'NSE:NIFTY50-INDEX',
      TradingStyle.Scalper,
      55,
      { CE: greeksInsight, PE: { ...greeksInsight, optionSide: 'PE' } },
      'IV Crushed',
      false,
    );
    expect(pair.CE?.moneyness).toBe('ATM');
    expect(pair.PE?.strike).toBe(25000);
  });
});