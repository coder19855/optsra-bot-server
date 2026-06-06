import { FyersAPI } from 'fyers-api-v3';
import { TradeAction } from '../types/technical-analysis';
import { FyersTradeFill, RoundTripTrade } from '../types/trading-coach';
import { sessionCoachFills } from './fyers-trades';
import {
  getIstSessionDate,
  parseFyersIstDateTime,
  resolveOptionMeta,
} from './symbol-utils';
import { toIso } from '../technical-analysis/timeline-utils';

interface OpenLot {
  qty: number;
  price: number;
  fill: FyersTradeFill;
}

function directionFromOptionType(optionType: 'CE' | 'PE'): TradeAction {
  return optionType === 'CE' ? 'CE-BUY' : 'PE-BUY';
}

function weightedAvg(
  lots: Array<{ qty: number; price: number }>,
): number {
  const totalQty = lots.reduce((sum, lot) => sum + lot.qty, 0);
  if (totalQty <= 0) return 0;
  const totalValue = lots.reduce((sum, lot) => sum + lot.qty * lot.price, 0);
  return +(totalValue / totalQty).toFixed(2);
}

export function mapTradeBookEntries(
  entries: FyersAPI.TradeBookEntry[],
): FyersTradeFill[] {
  return entries
    .map((row) => ({
      tradeNumber: row.tradeNumber,
      symbol: row.symbol,
      side: row.side,
      tradedQty: row.tradedQty,
      tradePrice: row.tradePrice,
      tradeValue: row.tradeValue,
      orderDateTime: row.orderDateTime,
      orderNumber: row.orderNumber,
      productType: row.productType,
      orderTag: row.orderTag,
    }))
    .filter(
      (fill) =>
        fill.tradeNumber &&
        fill.symbol &&
        fill.tradedQty > 0 &&
        fill.tradePrice > 0 &&
        Number.isFinite(parseFyersIstDateTime(fill.orderDateTime)),
    )
    .sort(
      (a, b) =>
        parseFyersIstDateTime(a.orderDateTime) -
        parseFyersIstDateTime(b.orderDateTime),
    );
}

/**
 * FIFO pairing of buy/sell fills into closed round-trip trades per option symbol.
 */
export function countInternalCarryFills(fills: FyersTradeFill[]): number {
  return fills.filter((fill) => fill.isInternalCarry).length;
}

export function pairRoundTripTrades(fills: FyersTradeFill[]): RoundTripTrade[] {
  const sessionFills = sessionCoachFills(fills);
  const bySymbol = new Map<string, FyersTradeFill[]>();

  for (const fill of sessionFills) {
    const bucket = bySymbol.get(fill.symbol) ?? [];
    bucket.push(fill);
    bySymbol.set(fill.symbol, bucket);
  }

  const roundTrips: RoundTripTrade[] = [];

  for (const [optionSymbol, symbolFills] of bySymbol.entries()) {
    const meta = resolveOptionMeta(optionSymbol);
    if (!meta) continue;

    const openLots: OpenLot[] = [];

    for (const fill of symbolFills) {
      if (fill.side === 1) {
        openLots.push({
          qty: fill.tradedQty,
          price: fill.tradePrice,
          fill,
        });
        continue;
      }

      let remaining = fill.tradedQty;
      const matchedEntryFills: FyersTradeFill[] = [];
      const matchedEntryLots: Array<{ qty: number; price: number }> = [];

      while (remaining > 0 && openLots.length > 0) {
        const lot = openLots[0];
        const matchedQty = Math.min(remaining, lot.qty);

        matchedEntryFills.push({
          ...lot.fill,
          tradedQty: matchedQty,
          tradeValue: +(matchedQty * lot.price).toFixed(2),
        });
        matchedEntryLots.push({ qty: matchedQty, price: lot.price });

        lot.qty -= matchedQty;
        remaining -= matchedQty;

        if (lot.qty <= 0) {
          openLots.shift();
        }
      }

      if (matchedEntryLots.length === 0) continue;

      const qty = matchedEntryLots.reduce((sum, lot) => sum + lot.qty, 0);
      const entryPremium = weightedAvg(matchedEntryLots);
      const exitPremium = fill.tradePrice;
      const pnlPremium = +(exitPremium - entryPremium).toFixed(2);
      const pnlInr = +(pnlPremium * qty).toFixed(2);

      const entryAtMs = parseFyersIstDateTime(matchedEntryFills[0].orderDateTime);
      const exitAtMs = parseFyersIstDateTime(fill.orderDateTime);

      roundTrips.push({
        id: `${fill.tradeNumber}-${matchedEntryFills[0].tradeNumber}`,
        optionSymbol,
        indexSymbol: meta.indexSymbol,
        underlying: meta.underlying,
        optionType: meta.optionType,
        direction: directionFromOptionType(meta.optionType),
        entryAtMs,
        exitAtMs,
        entryAtISO: toIso(entryAtMs),
        exitAtISO: toIso(exitAtMs),
        sessionDate: getIstSessionDate(entryAtMs),
        qty,
        entryPremium,
        exitPremium,
        pnlInr,
        pnlPremium,
        productType: fill.productType,
        entryFills: matchedEntryFills,
        exitFills: [{ ...fill, tradedQty: qty, tradeValue: +(qty * exitPremium).toFixed(2) }],
      });
    }
  }

  return roundTrips.sort((a, b) => b.exitAtMs - a.exitAtMs);
}