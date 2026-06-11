import { FyersAPI } from 'fyers-api-v3';
import { FastifyInstance } from 'fastify';
import { ResponseStatus } from '../types';
import {
  CoachPnlSummary,
  CoachSymbolPnl,
  FyersTradeFill,
  RoundTripTrade,
} from '../types/trading-coach';
import { parseFyersIstDateTime, resolveOptionMeta } from './symbol-utils';

export type CoachTradeSource = 'fyers_tradebook' | 'fyers_trade_history';

export interface CoachDateRange {
  fromDate: string;
  toDate: string;
  source: CoachTradeSource;
}

function formatIstDate(epochMs: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(epochMs));
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function resolveCoachDateRange(query: {
  date?: string;
  from_date?: string;
  to_date?: string;
  days?: string | number;
}): CoachDateRange | null {
  const today = formatIstDate(Date.now());

  if (query.date) {
    if (!isIsoDate(query.date)) return null;
    // Same-day fills live in the tradebook; trade history is often empty until EOD.
    if (query.date === today) return null;
    return {
      fromDate: query.date,
      toDate: query.date,
      source: 'fyers_trade_history',
    };
  }

  const fromDate = query.from_date;
  const toDate = query.to_date;
  if (fromDate || toDate) {
    if (!fromDate || !toDate || !isIsoDate(fromDate) || !isIsoDate(toDate)) {
      return null;
    }
    return {
      fromDate,
      toDate,
      source: 'fyers_trade_history',
    };
  }

  const daysRaw = query.days;
  if (daysRaw !== undefined && daysRaw !== '') {
    const days = Number(daysRaw);
    if (!Number.isFinite(days) || days <= 0) return null;
    const clamped = Math.min(90, Math.floor(days));
    const fromMs = Date.now() - (clamped - 1) * 24 * 60 * 60 * 1000;
    return {
      fromDate: formatIstDate(fromMs),
      toDate: today,
      source: 'fyers_trade_history',
    };
  }

  return null;
}

/** Fyers history includes carry/settlement rows that break FIFO if mixed with session fills. */
export function isInternalCarryFill(fill: Pick<FyersTradeFill, 'orderDateTime' | 'orderNumber'>): boolean {
  if (fill.orderDateTime.includes('00:00:00')) return true;
  if (fill.orderNumber.toUpperCase().startsWith('NDIR')) return true;
  return false;
}

export function sessionCoachFills(fills: FyersTradeFill[]): FyersTradeFill[] {
  return fills.filter((fill) => !fill.isInternalCarry);
}

function normalizeRow(row: Record<string, unknown>): FyersTradeFill | null {
  const tradeNumber = String(row.tradeNumber ?? '');
  const symbol = String(row.symbol ?? '');
  const side = Number(row.side) as 1 | -1;
  const tradedQty = Number(row.tradedQty ?? row.traded_qty ?? 0);
  const tradePrice = Number(row.tradePrice ?? row.trade_price ?? 0);
  const tradeValue = Number(row.tradeValue ?? row.trade_value ?? 0);
  const orderDateTime = String(row.orderDateTime ?? '');
  const orderNumber = String(row.orderNumber ?? '');
  const productType = String(row.productType ?? row.product_type ?? '');
  const orderTag = row.orderTag ? String(row.orderTag) : undefined;

  if (
    !tradeNumber ||
    !symbol ||
    !orderDateTime ||
    tradedQty <= 0 ||
    tradePrice <= 0 ||
    (side !== 1 && side !== -1) ||
    !Number.isFinite(parseFyersIstDateTime(orderDateTime))
  ) {
    return null;
  }

  const fill: FyersTradeFill = {
    tradeNumber,
    symbol,
    side,
    tradedQty,
    tradePrice,
    tradeValue: tradeValue > 0 ? tradeValue : +(tradedQty * tradePrice).toFixed(2),
    orderDateTime,
    orderNumber,
    productType,
    orderTag,
  };

  fill.isInternalCarry = isInternalCarryFill(fill);
  return fill;
}

export function mapFyersTradeRows(
  entries: Array<FyersAPI.TradeBookEntry | FyersAPI.TradeHistoryEntry>,
): FyersTradeFill[] {
  return entries
    .map((row) => normalizeRow(row as unknown as Record<string, unknown>))
    .filter((fill): fill is FyersTradeFill => fill !== null)
    .sort(
      (a, b) =>
        parseFyersIstDateTime(a.orderDateTime) -
        parseFyersIstDateTime(b.orderDateTime),
    );
}

export async function fetchCoachTradeFills(
  fyers: FastifyInstance['fyers'],
  range: CoachDateRange | null,
): Promise<{ source: CoachTradeSource; fills: FyersTradeFill[]; rawFillCount: number }> {
  if (!range) {
    const tradeBookRes = await fyers.get_tradebook();
    if (tradeBookRes.s !== ResponseStatus.ok) {
      throw new Error(tradeBookRes.message || 'Failed to fetch Fyers tradebook');
    }
    const fills = mapFyersTradeRows(tradeBookRes.tradeBook ?? []);
    return {
      source: 'fyers_tradebook',
      fills,
      rawFillCount: tradeBookRes.tradeBook?.length ?? 0,
    };
  }

  const historyRes = await fyers.get_trade_history({
    from_date: range.fromDate,
    to_date: range.toDate,
  });

  if (historyRes.s !== ResponseStatus.ok) {
    throw new Error(historyRes.message || 'Failed to fetch Fyers trade history');
  }

  const fills = mapFyersTradeRows(historyRes.data ?? []);
  return {
    source: 'fyers_trade_history',
    fills,
    rawFillCount: historyRes.data?.length ?? 0,
  };
}

export function sumRoundTripPnlInr(roundTrips: RoundTripTrade[]): number {
  return +roundTrips.reduce((sum, trade) => sum + trade.pnlInr, 0).toFixed(2);
}

/**
 * Prefer Fyers broker PnL (net realised) when available — it includes charges and
 * all closed symbols. FIFO session PnL only sums coached round-trip legs and ignores
 * open lots; use it only when Fyers has not published figures yet (common intraday).
 */
export function resolveCoachDisplayPnlInr(params: {
  fifoSessionPnlInr: number;
  pnlSummary: CoachPnlSummary | null;
  symbolPnl: CoachSymbolPnl[];
  indexFilter: string | null;
  tradeSource?: CoachTradeSource;
}): number {
  const fifo = +params.fifoSessionPnlInr.toFixed(2);
  if (!params.pnlSummary) return fifo;

  let fyersGross = params.pnlSummary.grossPnlInr;
  if (params.indexFilter && params.symbolPnl.length > 0) {
    fyersGross = +params.symbolPnl
      .reduce((sum, row) => sum + row.realizedPnlInr, 0)
      .toFixed(2);
  }

  const fyersNet = params.pnlSummary.netPnlInr;

  if (fyersGross === 0 && fyersNet === 0 && fifo !== 0) return fifo;

  // Live tradebook session: FIFO matches the coached legs listed below.
  // Fyers realised net can include other symbols, charges, and carry rows.
  if (params.tradeSource === 'fyers_tradebook' && !params.pnlSummary.reconciled) {
    return fifo;
  }

  if (params.pnlSummary.reconciled) {
    return params.indexFilter ? fyersGross : fyersNet;
  }

  if (
    Math.abs(fyersGross - fifo) >= 1 ||
    Math.abs(fyersNet - fifo) >= 1
  ) {
    if (params.indexFilter && params.symbolPnl.length > 0) return fyersGross;
    return fyersNet !== 0 ? fyersNet : fyersGross;
  }

  return fyersNet !== 0 ? fyersNet : fyersGross;
}

export function resolveCoachBrokerNetPnlInr(params: {
  pnlSummary: CoachPnlSummary | null;
  symbolPnl: CoachSymbolPnl[];
  indexFilter: string | null;
}): number | null {
  if (!params.pnlSummary) return null;
  if (params.indexFilter && params.symbolPnl.length > 0) {
    return +params.symbolPnl
      .reduce((sum, row) => sum + row.realizedPnlInr, 0)
      .toFixed(2);
  }
  return params.pnlSummary.netPnlInr;
}

export async function fetchRealisedProfitSummary(
  fyers: FastifyInstance['fyers'],
  range: CoachDateRange | null,
  roundTripSymbols: Set<string>,
  computedRoundTripPnlInr: number,
): Promise<{
  pnlSummary: CoachPnlSummary | null;
  symbolPnl: CoachSymbolPnl[];
}> {
  const today = formatIstDate(Date.now());
  const fromDate = range?.fromDate ?? today;
  const toDate = range?.toDate ?? today;

  try {
    const res = await fyers.get_realised_profit_history({
      from_date: fromDate,
      to_date: toDate,
    });

    if (res.s !== ResponseStatus.ok || !res.summary_data) {
      return { pnlSummary: null, symbolPnl: [] };
    }

    const grossPnlInr = +(res.summary_data.gross_pnl ?? 0).toFixed(2);
    const netPnlInr = +(res.summary_data.net_pnl ?? 0).toFixed(2);
    const chargesInr = +(res.summary_data.charges ?? 0).toFixed(2);
    const computed = +computedRoundTripPnlInr.toFixed(2);
    const delta = Math.abs(grossPnlInr - computed);
    const reconciled = delta < 1;

    const symbolPnl: CoachSymbolPnl[] = (res.data ?? []).map((row) => {
      const meta = resolveOptionMeta(row.symbol_name);
      return {
        optionSymbol: row.symbol_name,
        indexSymbol: meta?.indexSymbol ?? null,
        underlying: meta?.underlying ?? null,
        realizedPnlInr: +row.realized_pnl.toFixed(2),
        buyQty: row.buy_qty,
        sellQty: row.sell_qty,
        buyRate: +row.buy_rate.toFixed(4),
        sellRate: +row.sell_rate.toFixed(4),
        hasSessionRoundTrips: roundTripSymbols.has(row.symbol_name),
      };
    });

    return {
      pnlSummary: {
        source: 'fyers_realised_profit_history',
        grossPnlInr,
        netPnlInr,
        chargesInr,
        computedRoundTripPnlInr: computed,
        reconciled,
        reconciliationNote: reconciled
          ? undefined
          : 'Fyers gross PnL includes carry/settlement fills (00:00:00 / NDIR rows) and symbols without session timestamps. Session round-trip PnL is for coaching replay only.',
      },
      symbolPnl,
    };
  } catch {
    return { pnlSummary: null, symbolPnl: [] };
  }
}