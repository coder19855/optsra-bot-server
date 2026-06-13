import { FyersTradeFill } from '../types/trading-coach';
import { mergeRoundTripLegs, pairRoundTripTrades } from './trade-pairing';
import { RoundTripTrade } from '../types/trading-coach';

const SYMBOL = 'NSE:NIFTY2661623150PE';

function makeFill(
  params: Pick<FyersTradeFill, 'side' | 'tradedQty' | 'tradePrice' | 'orderDateTime'> &
    Partial<FyersTradeFill>,
): FyersTradeFill {
  const tradeValue = +(params.tradedQty * params.tradePrice).toFixed(2);
  return {
    tradeNumber: params.tradeNumber ?? `T-${params.orderDateTime}`,
    symbol: params.symbol ?? SYMBOL,
    side: params.side,
    tradedQty: params.tradedQty,
    tradePrice: params.tradePrice,
    tradeValue,
    orderDateTime: params.orderDateTime,
    orderNumber: params.orderNumber ?? 'O1',
    productType: params.productType ?? 'INTRADAY',
  };
}

describe('pairRoundTripTrades', () => {
  it('pairs partial exits as separate legs with distinct exit times', () => {
    const { roundTrips } = pairRoundTripTrades([
      makeFill({
        tradeNumber: 'B1',
        side: 1,
        tradedQty: 150,
        tradePrice: 100,
        orderDateTime: '11-Jun-2026 09:16:00',
      }),
      makeFill({
        tradeNumber: 'S1',
        side: -1,
        tradedQty: 75,
        tradePrice: 110,
        orderDateTime: '11-Jun-2026 09:45:00',
      }),
      makeFill({
        tradeNumber: 'S2',
        side: -1,
        tradedQty: 75,
        tradePrice: 120,
        orderDateTime: '11-Jun-2026 10:12:00',
      }),
    ]);

    expect(roundTrips).toHaveLength(2);
    expect(roundTrips[0].exitAtMs).toBeGreaterThan(roundTrips[1].exitAtMs);
    expect(roundTrips[0].qty).toBe(75);
    expect(roundTrips[1].qty).toBe(75);
    expect(roundTrips[0].pnlInr).toBe(1500);
    expect(roundTrips[1].pnlInr).toBe(750);
  });

  it('tracks remaining buy qty as an open position', () => {
    const { roundTrips, openPositions } = pairRoundTripTrades([
      makeFill({
        side: 1,
        tradedQty: 150,
        tradePrice: 100,
        orderDateTime: '11-Jun-2026 09:37:00',
      }),
      makeFill({
        side: -1,
        tradedQty: 75,
        tradePrice: 90,
        orderDateTime: '11-Jun-2026 09:50:00',
      }),
    ]);

    expect(roundTrips).toHaveLength(1);
    expect(roundTrips[0].pnlInr).toBe(-750);
    expect(openPositions).toHaveLength(1);
    expect(openPositions[0].qty).toBe(75);
    expect(openPositions[0].avgEntryPremium).toBe(100);
  });
});

describe('mergeRoundTripLegs', () => {
  function makeTrip(
    overrides: Partial<RoundTripTrade> & Pick<RoundTripTrade, 'qty' | 'pnlInr'>,
  ): RoundTripTrade {
    const entryAtMs = Date.parse('2026-06-11T14:46:00+05:30');
    const exitAtMs = Date.parse('2026-06-11T14:55:00+05:30');
    return {
      id: overrides.id ?? 'trip-1',
      optionSymbol: overrides.optionSymbol ?? SYMBOL,
      indexSymbol: 'NSE:NIFTY50-INDEX',
      underlying: 'NIFTY',
      optionType: 'PE',
      direction: 'PE-BUY',
      entryAtMs,
      exitAtMs,
      entryAtISO: new Date(entryAtMs).toISOString(),
      exitAtISO: new Date(exitAtMs).toISOString(),
      sessionDate: '2026-06-11',
      entryPremium: 100,
      exitPremium: 110,
      pnlPremium: 10,
      productType: 'INTRADAY',
      entryFills: [],
      exitFills: [],
      ...overrides,
    };
  }

  it('merges partial exits with the same symbol and entry/exit minute', () => {
    const merged = mergeRoundTripLegs([
      makeTrip({ id: 'a', qty: 65, pnlInr: 722 }),
      makeTrip({ id: 'b', qty: 65, pnlInr: 722 }),
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].qty).toBe(130);
    expect(merged[0].pnlInr).toBe(1444);
  });
});