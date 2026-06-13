import { FyersAPI } from 'fyers-api-v3';
import { TradeAction } from '../types/technical-analysis';
import {
  CoachOpenPosition,
  CoachPairingResult,
  FyersTradeFill,
  RoundTripTrade,
} from '../types/trading-coach';
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

export function pairRoundTripTrades(fills: FyersTradeFill[]): CoachPairingResult {
  const sessionFills = sessionCoachFills(fills);
  const bySymbol = new Map<string, FyersTradeFill[]>();

  for (const fill of sessionFills) {
    const bucket = bySymbol.get(fill.symbol) ?? [];
    bucket.push(fill);
    bySymbol.set(fill.symbol, bucket);
  }

  const roundTrips: RoundTripTrade[] = [];
  const openPositions: CoachOpenPosition[] = [];

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

      const exitAtMs = parseFyersIstDateTime(fill.orderDateTime);

      const entryAtMs = Math.min(
        ...matchedEntryFills.map((f) => parseFyersIstDateTime(f.orderDateTime)),
      );

      roundTrips.push({
        id: `${fill.tradeNumber}-${matchedEntryFills[0].tradeNumber}-${qty}`,
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

    if (openLots.length > 0) {
      const totalQty = openLots.reduce((sum, lot) => sum + lot.qty, 0);
      const avgEntryPremium = weightedAvg(
        openLots.map((lot) => ({ qty: lot.qty, price: lot.price })),
      );
      const entryAtMs = Math.min(
        ...openLots.map((lot) => parseFyersIstDateTime(lot.fill.orderDateTime)),
      );

      openPositions.push({
        optionSymbol,
        indexSymbol: meta.indexSymbol,
        underlying: meta.underlying,
        optionType: meta.optionType,
        direction: directionFromOptionType(meta.optionType),
        qty: totalQty,
        avgEntryPremium,
        entryAtMs,
        entryAtISO: toIso(entryAtMs),
        sessionDate: getIstSessionDate(entryAtMs),
        entryFills: openLots.map((lot) => ({
          ...lot.fill,
          tradedQty: lot.qty,
          tradeValue: +(lot.qty * lot.price).toFixed(2),
        })),
      });
    }
  }

  return {
    roundTrips: roundTrips.sort((a, b) => b.exitAtMs - a.exitAtMs),
    openPositions: openPositions.sort((a, b) => b.entryAtMs - a.entryAtMs),
  };
}

function roundTripMergeKey(trade: RoundTripTrade): string {
  const entryBucket = Math.floor(trade.entryAtMs / 60_000);
  const exitBucket = Math.floor(trade.exitAtMs / 60_000);
  return `${trade.optionSymbol}|${entryBucket}|${exitBucket}`;
}

function mergeRoundTripGroup(trips: RoundTripTrade[]): RoundTripTrade {
  if (trips.length === 1) return trips[0];

  const first = trips[0];
  const qty = trips.reduce((sum, trip) => sum + trip.qty, 0);
  const pnlInr = +trips.reduce((sum, trip) => sum + trip.pnlInr, 0).toFixed(2);
  const entryPremium = weightedAvg(
    trips.map((trip) => ({ qty: trip.qty, price: trip.entryPremium })),
  );
  const exitPremium = weightedAvg(
    trips.map((trip) => ({ qty: trip.qty, price: trip.exitPremium })),
  );
  const pnlPremium = +(exitPremium - entryPremium).toFixed(2);
  const entryAtMs = Math.min(...trips.map((trip) => trip.entryAtMs));
  const exitAtMs = Math.max(...trips.map((trip) => trip.exitAtMs));

  return {
    ...first,
    id: `${first.optionSymbol}-${entryAtMs}-${exitAtMs}-${qty}`,
    qty,
    entryPremium,
    exitPremium,
    pnlPremium,
    pnlInr,
    entryAtMs,
    exitAtMs,
    entryAtISO: toIso(entryAtMs),
    exitAtISO: toIso(exitAtMs),
    sessionDate: getIstSessionDate(entryAtMs),
    entryFills: trips.flatMap((trip) => trip.entryFills),
    exitFills: trips.flatMap((trip) => trip.exitFills),
  };
}

/** Collapse partial-fill legs that share symbol + entry/exit minute into one coached trade. */
export function mergeRoundTripLegs(roundTrips: RoundTripTrade[]): RoundTripTrade[] {
  const groups = new Map<string, RoundTripTrade[]>();

  for (const trip of roundTrips) {
    const key = roundTripMergeKey(trip);
    const bucket = groups.get(key) ?? [];
    bucket.push(trip);
    groups.set(key, bucket);
  }

  return [...groups.values()]
    .map((trips) => mergeRoundTripGroup(trips))
    .sort((a, b) => b.exitAtMs - a.exitAtMs);
}