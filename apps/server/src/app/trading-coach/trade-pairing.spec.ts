import { FyersTradeFill } from '../types/trading-coach';
import { pairRoundTripTrades } from './trade-pairing';

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