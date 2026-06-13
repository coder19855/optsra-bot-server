import { FastifyInstance } from 'fastify';
import { FYERS_OPTION_INDEX_SYMBOLS } from '../constants/fyers-symbols';
import { ExactStrikeRecommendation } from '../types/exact-strike-recommendation';
import { TradeSetup } from '../types/technical-analysis';
import { DecisionAction } from '../types/trade-decision';
import { TradingStyle } from '../types/trading-style';
import { DeckMarketRegime } from './market-regime';
import { resolveTelegramPositionSizing } from './position-sizing-context';

export interface DeckTradePlannerTarget {
  rr: string;
  indexPrice: number;
  indexMovePts: number;
  rewardPerLotInr: number;
}

export interface DeckLotScenarioRow {
  lots: number;
  capitalAtRiskInr: number;
  marginInr: number | null;
  reward1RInr: number;
  reward2RInr: number;
  reward3RInr: number;
  fitsRiskBudget: boolean;
  fitsMarginCap: boolean;
  recommended: boolean;
}

export interface DeckTradePlannerPayload {
  favorable: boolean;
  suggestion: 'CE' | 'PE' | null;
  suggestionAction: string | null;
  headline: string;
  detail: string | null;
  conviction: number;
  enterThreshold: number;
  setup: {
    entry: number;
    stopLoss: number;
    riskPoints: number;
    targets: DeckTradePlannerTarget[];
  } | null;
  strike: {
    symbol: string;
    strike: number;
    premium: number;
    delta: number | null;
    lotSize: number;
  } | null;
  account: {
    availableBalance: number | null;
    riskBudgetInr: number | null;
    riskPerLotInr: number | null;
    recommendedLots: number | null;
    maxLotsByRisk: number | null;
    maxLotsByMargin: number | null;
  };
  scenarios: DeckLotScenarioRow[];
  unavailableReason: string | null;
  replayNote: string | null;
}

const MAX_LOT_SCENARIOS = 5;

function roundInr(value: number): number {
  return Math.round(value * 100) / 100;
}

function resolveSuggestion(
  action: string,
  structuralAction?: string,
): { side: 'CE' | 'PE' | null; action: string | null } {
  if (action === 'CE-BUY' || action === 'PE-BUY') {
    return {
      side: action === 'CE-BUY' ? 'CE' : 'PE',
      action,
    };
  }
  if (structuralAction === 'CE-BUY' || structuralAction === 'PE-BUY') {
    return {
      side: structuralAction === 'CE-BUY' ? 'CE' : 'PE',
      action: structuralAction,
    };
  }
  return { side: null, action: null };
}

function buildTargets(
  setup: TradeSetup,
  riskPerLotInr: number,
): DeckTradePlannerTarget[] {
  return setup.takeProfits.map((tp) => {
    const indexMovePts = Math.abs(tp.price - setup.entry);
    const multiplier = tp.multiplier ?? Number(tp.rr.split(':')[1] ?? 1);
    return {
      rr: tp.rr,
      indexPrice: tp.price,
      indexMovePts: roundInr(indexMovePts),
      rewardPerLotInr: roundInr(riskPerLotInr * multiplier),
    };
  });
}

function buildScenarios(params: {
  riskPerLotInr: number;
  premium: number | null;
  lotSize: number;
  recommendedLots: number | null;
  maxLotsByRisk: number | null;
  maxLotsByMargin: number | null;
}): DeckLotScenarioRow[] {
  const rows: DeckLotScenarioRow[] = [];
  for (let lots = 1; lots <= MAX_LOT_SCENARIOS; lots += 1) {
    const capitalAtRiskInr = roundInr(params.riskPerLotInr * lots);
    const marginInr =
      params.premium != null && params.premium > 0
        ? roundInr(params.premium * params.lotSize * lots)
        : null;

    rows.push({
      lots,
      capitalAtRiskInr,
      marginInr,
      reward1RInr: capitalAtRiskInr,
      reward2RInr: roundInr(params.riskPerLotInr * lots * 2),
      reward3RInr: roundInr(params.riskPerLotInr * lots * 3),
      fitsRiskBudget:
        params.maxLotsByRisk == null || lots <= params.maxLotsByRisk,
      fitsMarginCap:
        params.maxLotsByMargin == null || lots <= params.maxLotsByMargin,
      recommended: params.recommendedLots === lots,
    });
  }
  return rows;
}

function favorableHeadline(side: 'CE' | 'PE', regime?: DeckMarketRegime): string {
  const regimeNote =
    regime?.kind === 'trending'
      ? ' · trending tape'
      : regime?.kind === 'sideways'
        ? ' · sideways — size down'
        : '';
  return `Favorable ${side} setup${regimeNote}`;
}

export async function buildDeckTradePlanner(
  fastify: FastifyInstance,
  params: {
    symbol: string;
    tradingStyle: TradingStyle;
    action: string;
    conviction: number;
    enterThreshold: number;
    shouldConsiderTrade: boolean;
    structuralAction?: string;
    tradeSetup?: TradeSetup | null;
    exactStrike?: ExactStrikeRecommendation | null;
    signalConfidence?: number;
    signalAction?: string;
    marketRegime?: DeckMarketRegime;
    replayMode?: boolean;
  },
): Promise<DeckTradePlannerPayload> {
  const indexMeta = FYERS_OPTION_INDEX_SYMBOLS.find(
    (row) => row.symbol === params.symbol,
  );
  const lotSize = indexMeta?.lotSize ?? 1;
  const suggestion = resolveSuggestion(
    params.action,
    params.structuralAction,
  );
  const setup =
    params.tradeSetup &&
    params.tradeSetup.risk > 0 &&
    params.tradeSetup.takeProfits?.length
      ? params.tradeSetup
      : null;

  const baseUnavailable: DeckTradePlannerPayload = {
    favorable: false,
    suggestion: suggestion.side,
    suggestionAction: suggestion.action,
    headline: suggestion.side
      ? `Watch ${suggestion.side} — conditions not met`
      : 'No directional setup',
    detail: null,
    conviction: params.conviction,
    enterThreshold: params.enterThreshold,
    setup: null,
    strike: null,
    account: {
      availableBalance: null,
      riskBudgetInr: null,
      riskPerLotInr: null,
      recommendedLots: null,
      maxLotsByRisk: null,
      maxLotsByMargin: null,
    },
    scenarios: [],
    unavailableReason: null,
    replayNote: params.replayMode
      ? 'Replay uses static R:R math — live funds and margin apply in live mode.'
      : null,
  };

  if (!suggestion.side || !setup) {
    return {
      ...baseUnavailable,
      unavailableReason: !setup
        ? 'No index entry/stop/target setup on chart yet.'
        : 'Engine has no CE/PE buy suggestion right now.',
    };
  }

  const meetsConviction = params.conviction >= params.enterThreshold;
  const favorable =
    params.shouldConsiderTrade &&
    meetsConviction &&
    (params.action === 'CE-BUY' || params.action === 'PE-BUY');

  let detail: string | null = null;
  if (!favorable) {
    if (!params.shouldConsiderTrade) {
      detail = 'Trade guidance says wait — conviction or alignment not ready.';
    } else if (!meetsConviction) {
      detail = `Conviction ${params.conviction}% is below enter bar ${params.enterThreshold}%.`;
    } else if (params.action !== suggestion.action) {
      detail = `Chart structure favors ${suggestion.side}, but blended action is ${params.action}.`;
    }
  }

  const exactStrike = params.exactStrike ?? null;
  const strikePremium = exactStrike?.premium ?? null;
  const strikeDelta = exactStrike?.delta ?? null;

  if (params.replayMode) {
    const delta = strikeDelta ?? 0.5;
    const riskPerLotInr = roundInr(setup.risk * lotSize * delta);
    const scenarios = buildScenarios({
      riskPerLotInr,
      premium: strikePremium,
      lotSize,
      recommendedLots: null,
      maxLotsByRisk: null,
      maxLotsByMargin: null,
    });

    return {
      favorable,
      suggestion: suggestion.side,
      suggestionAction: suggestion.action,
      headline: favorable
        ? favorableHeadline(suggestion.side, params.marketRegime)
        : baseUnavailable.headline,
      detail,
      conviction: params.conviction,
      enterThreshold: params.enterThreshold,
      setup: {
        entry: setup.entry,
        stopLoss: setup.stopLoss,
        riskPoints: setup.risk,
        targets: buildTargets(setup, riskPerLotInr),
      },
      strike: exactStrike
        ? {
            symbol: exactStrike.fyersSymbol,
            strike: exactStrike.strike,
            premium: exactStrike.premium,
            delta: exactStrike.delta,
            lotSize: exactStrike.lotSize,
          }
        : null,
      account: {
        availableBalance: null,
        riskBudgetInr: null,
        riskPerLotInr,
        recommendedLots: null,
        maxLotsByRisk: null,
        maxLotsByMargin: null,
      },
      scenarios,
      unavailableReason: null,
      replayNote: baseUnavailable.replayNote,
    };
  }

  const sizingAction: DecisionAction =
    params.action === 'CE-BUY' || params.action === 'PE-BUY'
      ? params.action
      : suggestion.action === 'CE-BUY' || suggestion.action === 'PE-BUY'
        ? suggestion.action
        : 'NO-TRADE';

  const sizing = await resolveTelegramPositionSizing(fastify, {
    symbol: params.symbol,
    tradingStyle: params.tradingStyle,
    action: sizingAction,
    signalConfidence: params.signalConfidence ?? params.conviction,
    signalAction: params.signalAction ?? params.action,
    tradeSetup: setup,
  });

  if (sizing.unavailableReason || !sizing.riskPerLotInr) {
    const delta = strikeDelta ?? 0.5;
    const riskPerLotInr = roundInr(setup.risk * lotSize * delta);
    return {
      ...baseUnavailable,
      favorable,
      headline: favorable
        ? favorableHeadline(suggestion.side, params.marketRegime)
        : baseUnavailable.headline,
      detail,
      setup: {
        entry: setup.entry,
        stopLoss: setup.stopLoss,
        riskPoints: setup.risk,
        targets: buildTargets(setup, riskPerLotInr),
      },
      strike: exactStrike
        ? {
            symbol: exactStrike.fyersSymbol,
            strike: exactStrike.strike,
            premium: exactStrike.premium,
            delta: exactStrike.delta,
            lotSize: exactStrike.lotSize,
          }
        : null,
      account: {
        availableBalance: sizing.availableBalance,
        riskBudgetInr: sizing.riskBudgetInr ?? null,
        riskPerLotInr,
        recommendedLots: null,
        maxLotsByRisk: sizing.maxLotsByRisk ?? null,
        maxLotsByMargin: sizing.maxLotsByMargin ?? null,
      },
      scenarios: buildScenarios({
        riskPerLotInr,
        premium: strikePremium ?? sizing.atmPremium ?? null,
        lotSize,
        recommendedLots: null,
        maxLotsByRisk: sizing.maxLotsByRisk ?? null,
        maxLotsByMargin: sizing.maxLotsByMargin ?? null,
      }),
      unavailableReason: sizing.unavailableReason ?? null,
      replayNote: null,
    };
  }

  const premium =
    strikePremium ?? sizing.atmPremium ?? null;
  const scenarios = buildScenarios({
    riskPerLotInr: sizing.riskPerLotInr,
    premium,
    lotSize: sizing.lotSize,
    recommendedLots: sizing.recommendedLots ?? null,
    maxLotsByRisk: sizing.maxLotsByRisk ?? null,
    maxLotsByMargin: sizing.maxLotsByMargin ?? null,
  });

  return {
    favorable,
    suggestion: suggestion.side,
    suggestionAction: suggestion.action,
    headline: favorable
      ? favorableHeadline(suggestion.side, params.marketRegime)
      : baseUnavailable.headline,
    detail,
    conviction: params.conviction,
    enterThreshold: params.enterThreshold,
    setup: {
      entry: setup.entry,
      stopLoss: setup.stopLoss,
      riskPoints: setup.risk,
      targets: buildTargets(setup, sizing.riskPerLotInr),
    },
    strike: exactStrike
      ? {
          symbol: exactStrike.fyersSymbol,
          strike: exactStrike.strike,
          premium: exactStrike.premium,
          delta: exactStrike.delta,
          lotSize: exactStrike.lotSize,
        }
      : sizing.atmStrike != null && premium != null
        ? {
            symbol: `${suggestion.side} ATM`,
            strike: sizing.atmStrike,
            premium,
            delta: strikeDelta,
            lotSize: sizing.lotSize,
          }
        : null,
    account: {
      availableBalance: sizing.availableBalance,
      riskBudgetInr: sizing.riskBudgetInr ?? null,
      riskPerLotInr: sizing.riskPerLotInr,
      recommendedLots: sizing.recommendedLots ?? null,
      maxLotsByRisk: sizing.maxLotsByRisk ?? null,
      maxLotsByMargin: sizing.maxLotsByMargin ?? null,
    },
    scenarios,
    unavailableReason: null,
    replayNote: null,
  };
}