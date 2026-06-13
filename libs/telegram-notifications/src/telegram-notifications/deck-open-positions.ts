import { FyersAPI } from 'fyers-api-v3';
import { FastifyInstance } from 'fastify';
import { FYERS_OPTION_INDEX_SYMBOLS } from '../constants/fyers-symbols';
import { buildLegGreeksProfile } from '../option-flow/greeks-moneyness-insight';
import {
  parseStrikeFromFyersOptionSymbol,
  resolveOptionMeta,
} from '../trading-coach/symbol-utils';
import { ResponseStatus } from '../types/common';
import {
  GreeksGammaLevel,
  GreeksMoneyness,
} from '../types/greeks-strike-insight';
import { OptionType } from '../types/options';
import { fetchOpenIndexOptionPositions } from './position-monitor';

export interface DeckOpenPositionGreekImpact {
  deltaNote: string | null;
  gammaNote: string | null;
  thetaNote: string | null;
  move50PtsNote: string | null;
  summary: string | null;
}

export interface DeckOpenPositionEntry {
  symbol: string;
  optionLabel: string;
  indexSymbol: string;
  indexLabel: string;
  direction: 'CE-BUY' | 'PE-BUY';
  netQty: number;
  lots: number;
  lotSize: number;
  buyAvg: number;
  ltp: number | null;
  unrealizedPnl: number;
  strike: number | null;
  moneyness: GreeksMoneyness | null;
  delta: number | null;
  gammaLevel: GreeksGammaLevel | null;
  spot: number | null;
  isWatchedIndex: boolean;
  greeksImpact: DeckOpenPositionGreekImpact;
}

export interface DeckOpenPositionsPayload {
  asOf: string;
  entries: DeckOpenPositionEntry[];
  note: string | null;
}

function indexLotSize(indexSymbol: string): number {
  return (
    FYERS_OPTION_INDEX_SYMBOLS.find((row) => row.symbol === indexSymbol)
      ?.lotSize ?? 1
  );
}

function gammaImpactNote(level: GreeksGammaLevel | null): string | null {
  if (!level) return null;
  if (level === 'high') {
    return 'High gamma — P&L accelerates on bursts; painful if spot pins or chops.';
  }
  if (level === 'low') {
    return 'Low gamma — needs a larger index move to shift premium meaningfully.';
  }
  return 'Moderate gamma — tracks spot at a steady pace.';
}

function deltaImpactNote(delta: number | null): string | null {
  if (delta == null) return null;
  const pct = Math.round(delta * 100);
  return `Delta ${delta.toFixed(2)} — premium moves ~${pct}% as fast as the index per point.`;
}

function move50PtsNote(delta: number | null, netQty: number): string | null {
  if (delta == null || netQty <= 0) return null;
  const amount = Math.round(delta * 50 * netQty * 10) / 10;
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return `50 pt index move ≈ ±₹${amount} on this leg`;
}

function thetaImpactNote(
  thetaLabel: string | null,
  lots: number,
): string | null {
  if (!thetaLabel || lots <= 0) return null;

  const match = thetaLabel.match(/₹([\d.]+)\/lot·day/);
  if (match && lots !== 1) {
    const perLot = Number(match[1]);
    if (Number.isFinite(perLot)) {
      const total = perLot * lots;
      const formatted = total >= 100 ? total.toFixed(0) : total.toFixed(1);
      return `Time decay: ≈ ₹${formatted}/day (${lots.toFixed(1)} lots)`;
    }
  }

  return `Time decay: ${thetaLabel}`;
}

function buildGreekImpact(params: {
  delta: number | null;
  gammaLevel: GreeksGammaLevel | null;
  thetaLabel: string | null;
  lots: number;
  netQty: number;
  summary: string | null;
}): DeckOpenPositionGreekImpact {
  return {
    deltaNote: deltaImpactNote(params.delta),
    gammaNote: gammaImpactNote(params.gammaLevel),
    thetaNote: thetaImpactNote(params.thetaLabel, params.lots),
    move50PtsNote: move50PtsNote(params.delta, params.netQty),
    summary: params.summary,
  };
}

function findChainRow(
  chain: FyersAPI.OptionChainData[],
  symbol: string,
  strike: number | null,
  optionType: 'CE' | 'PE',
): FyersAPI.OptionChainData | undefined {
  const bySymbol = chain.find((row) => row.symbol === symbol);
  if (bySymbol) return bySymbol;

  if (strike == null) return undefined;
  const type = optionType === 'CE' ? OptionType.CE : OptionType.PE;
  return chain.find(
    (row) => row.strike_price === strike && row.option_type === type,
  );
}

async function fetchIndexOptionChain(
  fastify: FastifyInstance,
  indexSymbol: string,
): Promise<{
  spot: number;
  chain: FyersAPI.OptionChainData[];
  expiryData: FyersAPI.ExpiryData[];
} | null> {
  const response = await fastify.fyers.getOptionChain({
    symbol: indexSymbol,
    strikecount: 30,
    timestamp: '',
    greeks: 1,
  });

  if (response.s !== ResponseStatus.ok || !response.data?.optionsChain?.length) {
    return null;
  }

  const [spotRow, ...chain] = response.data.optionsChain;
  return {
    spot: spotRow?.ltp ?? 0,
    chain,
    expiryData: response.data.expiryData ?? [],
  };
}

function resolvePositionLtp(
  fastify: FastifyInstance,
  symbol: string,
  chainRow: FyersAPI.OptionChainData | undefined,
): number | null {
  const streamed = fastify.fyersMarketStream?.getOptionLtp(symbol);
  if (streamed != null && streamed > 0) return streamed;
  if (chainRow?.ltp != null && chainRow.ltp > 0) return chainRow.ltp;
  return null;
}

export async function buildDeckOpenPositions(
  fastify: FastifyInstance,
  params: {
    watchedIndexSymbol: string;
    ivRegime?: string;
  },
): Promise<DeckOpenPositionsPayload> {
  const allIndexSymbols = FYERS_OPTION_INDEX_SYMBOLS.map((row) => row.symbol);
  const positions = await fetchOpenIndexOptionPositions(
    fastify,
    allIndexSymbols,
  );

  if (!positions.length) {
    return {
      asOf: new Date().toISOString(),
      entries: [],
      note: 'No open index option legs in Fyers.',
    };
  }

  const chainCache = new Map<
    string,
    Awaited<ReturnType<typeof fetchIndexOptionChain>>
  >();

  const entries: DeckOpenPositionEntry[] = [];

  for (const position of positions) {
    const meta = resolveOptionMeta(position.symbol);
    if (!meta) continue;

    let chainBundle = chainCache.get(position.indexSymbol);
    if (chainBundle === undefined) {
      chainBundle = await fetchIndexOptionChain(fastify, position.indexSymbol);
      chainCache.set(position.indexSymbol, chainBundle);
    }

    const lotSize = indexLotSize(position.indexSymbol);
    const lots = lotSize > 0 ? position.netQty / lotSize : position.netQty;
    const strike = parseStrikeFromFyersOptionSymbol(position.symbol);
    const chainRow = chainBundle
      ? findChainRow(
          chainBundle.chain,
          position.symbol,
          strike,
          meta.optionType,
        )
      : undefined;
    const spot = chainBundle?.spot ?? null;
    const profile =
      chainBundle && strike != null && spot != null && spot > 0
        ? buildLegGreeksProfile({
            chain: chainBundle.chain,
            spot,
            optionSide: meta.optionType,
            strike,
            ivRegime: params.ivRegime,
            context: {
              indexSymbol: position.indexSymbol,
              expiryData: chainBundle.expiryData,
            },
          })
        : null;

    const ltp = resolvePositionLtp(fastify, position.symbol, chainRow);

    entries.push({
      symbol: position.symbol,
      optionLabel: position.optionLabel,
      indexSymbol: position.indexSymbol,
      indexLabel: position.indexLabel,
      direction: position.direction,
      netQty: position.netQty,
      lots,
      lotSize,
      buyAvg: position.buyAvg,
      ltp,
      unrealizedPnl: position.unrealizedPnl,
      strike: profile?.strike ?? strike,
      moneyness: profile?.moneyness ?? null,
      delta: profile?.delta ?? null,
      gammaLevel: profile?.gammaLevel ?? null,
      spot,
      isWatchedIndex: position.indexSymbol === params.watchedIndexSymbol,
      greeksImpact: buildGreekImpact({
        delta: profile?.delta ?? null,
        gammaLevel: profile?.gammaLevel ?? null,
        thetaLabel: profile?.thetaLabel ?? null,
        lots,
        netQty: position.netQty,
        summary: profile?.consequence ?? null,
      }),
    });
  }

  entries.sort((a, b) => {
    if (a.isWatchedIndex !== b.isWatchedIndex) return a.isWatchedIndex ? -1 : 1;
    return Math.abs(b.unrealizedPnl) - Math.abs(a.unrealizedPnl);
  });

  return {
    asOf: new Date().toISOString(),
    entries,
    note: null,
  };
}