import { FastifyInstance } from 'fastify';
import { computeAdaptiveConviction } from './adaptive-conviction';
import { buildAlertWhyContext } from './why-context-builder';
import {
  commandTradeCacheKey,
  getRecentCommandTradeDecision,
  rememberCommandTradeDecision,
} from './command-trade-cache';
import { GreeksStrikeInsight } from '../types/greeks-strike-insight';
import { ExactStrikeRecommendation } from '../types/exact-strike-recommendation';
import { AdaptiveConvictionInsight } from '../types/adaptive-conviction';
import { AlertWhyContext } from '../types/alert-intelligence';
import { PriceActionResponse } from '../types/technical-analysis';
import { TradingStyle } from '../types/trading-style';
import {
  TradeDecisionAlertPayload,
  TradeStructureContext,
} from '../types/telegram-notifications';
import { DecisionAction } from '../types/trade-decision';
import {
  formatTradeDecisionError,
  normalizePriceActionSignal,
} from './management-decision-mapper';
import { resolveTelegramPositionSizing } from './position-sizing-context';
import {
  PollMarketDataContext,
  pollPriceActionCacheKey,
  pollTradeDecisionCacheKey,
} from '../market-data/poll-market-data-context';

export interface FetchTradeDecisionOptions {
  vetoMode?: import('../types/veto-mode').VetoMode;
  /** @deprecated use vetoMode */
  vetoOff?: boolean;
  flowMode?: import('../types/flow-mode').FlowMode;
  pollContext?: PollMarketDataContext;
  /** Bypass the 30s command cache and always recompute. */
  forceFresh?: boolean;
  /** Caller already verified Fyers via API — skip duplicate get_profile in trade-decision. */
  sessionVerified?: boolean;
  /** Skip funds/ATM sizing enrichment (e.g. /rr). */
  skipPositionSizing?: boolean;
  /** Skip Mongo adaptive conviction lookup. */
  skipAdaptiveConviction?: boolean;
}

function buildStructureContext(
  body: Record<string, unknown>,
  tradingStyle: TradingStyle,
): TradeStructureContext | undefined {
  const rawPrice = (body._debug as { rawPrice?: PriceActionResponse } | undefined)
    ?.rawPrice;
  const scores = rawPrice?.timeframeScores;
  if (!scores) return undefined;

  const thresholds = body.convictionThresholds as
    | { enter?: number }
    | undefined;
  const primaryTF =
    (body.primaryTimeframe as TradeStructureContext['primaryTimeframe']) ||
    (tradingStyle === TradingStyle.Scalper
      ? '5m'
      : tradingStyle === TradingStyle.Positional
        ? '1h'
        : '15m');

  return {
    primaryTimeframe: primaryTF,
    primaryScore: scores[primaryTF] ?? 0,
    timeframeScores: {
      '5m': scores['5m'] ?? 0,
      '15m': scores['15m'] ?? 0,
      '1h': scores['1h'] ?? 0,
    },
    enterThreshold: thresholds?.enter ?? 60,
  };
}

function parseTradingStyle(value: string): TradingStyle {
  const upper = value.toUpperCase();
  if (upper === TradingStyle.Scalper) return TradingStyle.Scalper;
  if (upper === TradingStyle.Positional) return TradingStyle.Positional;
  return TradingStyle.Intraday;
}

type PriceActionOverallSignal = {
  action?: string;
  confidence?: number;
  structuralAction?: string;
  vetoReason?: string;
  confidenceBeforeDecay?: number;
};

function readOverallSignal(
  body: Record<string, unknown>,
): PriceActionOverallSignal | undefined {
  return (body.priceAction as { overallSignal?: PriceActionOverallSignal } | undefined)
    ?.overallSignal;
}

function deriveTradeDecisionAction(
  body: Record<string, unknown>,
  normalizedPa: ReturnType<typeof normalizePriceActionSignal>,
): DecisionAction {
  if (body.action) {
    return body.action as DecisionAction;
  }
  if (normalizedPa.action === 'CE-BUY' || normalizedPa.action === 'PE-BUY') {
    return normalizedPa.action;
  }
  if (String(body.bias).includes('Neutral')) {
    return 'NEUTRAL';
  }
  return 'NO-TRADE';
}

function extractTradeDecisionSignals(body: Record<string, unknown>) {
  const debug = body._debug as { rawPrice?: PriceActionResponse } | undefined;
  const rawPrice = debug?.rawPrice;
  const tradeSetup = rawPrice?.tradeSetup ?? null;
  const normalizedPa = normalizePriceActionSignal(readOverallSignal(body));
  const action = deriveTradeDecisionAction(body, normalizedPa);
  const signalConfidence = Number(
    rawPrice?.signal?.confidence ?? normalizedPa.confidence,
  );
  const signalAction = String(rawPrice?.signal?.action ?? normalizedPa.action);
  return { debug, rawPrice, tradeSetup, normalizedPa, action, signalConfidence, signalAction };
}

export function mapTradeDecisionBodyToPayload(
  body: Record<string, unknown>,
  symbol: string,
  tradingStyle: TradingStyle,
  enrichment?: {
    positionSizing?: TradeDecisionAlertPayload['positionSizing'];
    adaptiveConviction?: AdaptiveConvictionInsight;
  },
): TradeDecisionAlertPayload {
  const tradeGuidance = body.tradeGuidance as Record<string, unknown> | undefined;
  const optionFlow = body.optionFlow as Record<string, unknown> | undefined;
  const strategies =
    (body.recommendedStrategies as Array<Record<string, unknown>>) || [];

  const { rawPrice, normalizedPa, action } = extractTradeDecisionSignals(body);
  const paAction = normalizedPa.action;
  const paConfidence = normalizedPa.confidence;
  const structuralAction = normalizedPa.structuralAction;
  const vetoReason = normalizedPa.vetoReason;
  const confidenceBeforeDecay = normalizedPa.confidenceBeforeDecay;
  const tradeSetup = rawPrice?.tradeSetup ?? null;
  const whyContext: AlertWhyContext = buildAlertWhyContext(body);
  const exactStrikeRecommendation =
    (optionFlow?.exactStrikeRecommendation as ExactStrikeRecommendation | null) ??
    undefined;
  const structureContext = buildStructureContext(body, tradingStyle);
  const confluence = rawPrice?.confluenceContext;
  const chartPattern =
    confluence?.chartPattern && confluence.chartPattern !== 'none'
      ? {
          pattern: confluence.chartPattern,
          status: confluence.chartPatternStatus,
          direction: confluence.chartPatternDirection,
          neckline: confluence.chartPatternNeckline,
          timeframe: structureContext?.primaryTimeframe,
        }
      : undefined;

  return {
    symbol: String(body.symbol || symbol),
    tradingStyle: parseTradingStyle(String(body.tradingStyle || tradingStyle)),
    lastPrice: Number(body.lastPrice ?? 0),
    action,
    bias: body.bias as TradeDecisionAlertPayload['bias'],
    conviction: Number(body.conviction ?? 0),
    structureContext,
    recommendation: String(body.recommendation ?? ''),
    humanSummary: String(body.humanSummary ?? ''),
    tradeGuidance: {
      shouldConsiderTrade: Boolean(tradeGuidance?.shouldConsiderTrade),
      sizeRecommendation: tradeGuidance?.sizeRecommendation
        ? String(tradeGuidance.sizeRecommendation)
        : undefined,
      notes: tradeGuidance?.notes ? String(tradeGuidance.notes) : undefined,
    },
    priceAction: {
      action: paAction as TradeDecisionAlertPayload['priceAction']['action'],
      confidence: paConfidence,
      structuralAction:
        structuralAction === 'CE-BUY' || structuralAction === 'PE-BUY'
          ? structuralAction
          : undefined,
      vetoReason,
      confidenceBeforeDecay,
    },
    optionFlow: optionFlow
      ? {
          bias: optionFlow.bias ? String(optionFlow.bias) : undefined,
          ivRegime: optionFlow.ivRegime ? String(optionFlow.ivRegime) : undefined,
          greeksStrikeInsight:
            (optionFlow.greeksStrikeInsight as GreeksStrikeInsight | null) ??
            undefined,
        }
      : undefined,
    exactStrikeRecommendation,
    whyContext,
    adaptiveConviction: enrichment?.adaptiveConviction,
    recommendedStrategies: strategies.map((s) => ({
      strategy: String(s.strategy ?? ''),
      risk: s.risk ? String(s.risk) : undefined,
      confidenceScore:
        s.confidenceScore != null ? Number(s.confidenceScore) : undefined,
      reason: s.reason ? String(s.reason) : undefined,
      executionHint: s.executionHint ? String(s.executionHint) : undefined,
    })),
    positionSizing: enrichment?.positionSizing,
    tradeSetup,
    momentumDecayPercent: rawPrice?.momentumDecay?.decayPercent ?? null,
    chartPattern,
    aiAnalysis: body.aiAnalysis as import('../types/ai-agent').AIAnalysisResponse | undefined,
    _decisionBody: body,
  };
}

export async function fetchTradeDecisionAlert(
  fastify: FastifyInstance,
  symbol: string,
  tradingStyle: TradingStyle,
  options?: FetchTradeDecisionOptions,
): Promise<TradeDecisionAlertPayload | null> {
  const vetoMode =
    options?.vetoMode ?? (options?.vetoOff ? 'off' : 'strict');
  const flowMode = options?.flowMode ?? 'blend';
  const cacheKey = pollTradeDecisionCacheKey(
    symbol,
    tradingStyle,
    vetoMode,
    flowMode,
  );

  const pollCached = options?.pollContext?.tradeDecisionCache.get(cacheKey);
  if (pollCached) {
    rememberCommandTradeDecision(
      commandTradeCacheKey(symbol, tradingStyle, vetoMode, flowMode),
      pollCached,
    );
    return pollCached;
  }

  if (!options?.forceFresh) {
    const recent = getRecentCommandTradeDecision(
      commandTradeCacheKey(symbol, tradingStyle, vetoMode, flowMode),
    );
    if (recent) {
      return recent;
    }
  }

  const vetoQuery = `&vetoMode=${encodeURIComponent(vetoMode)}`;
  const flowQuery = `&flowMode=${encodeURIComponent(flowMode)}`;
  const sessionQuery = options?.sessionVerified ? '&sessionVerified=1' : '';
  const res = await fastify.inject({
    method: 'GET',
    url: `/api/trade-decision?symbol=${encodeURIComponent(symbol)}&tradingStyle=${tradingStyle}${vetoQuery}${flowQuery}${sessionQuery}`,
  });

  if (res.statusCode !== 200) {
    throw new Error(
      `${formatTradeDecisionError(res.statusCode, res.body)} [${symbol}/${tradingStyle}]`,
    );
  }

  const body = JSON.parse(res.body) as Record<string, unknown>;
  const { rawPrice, tradeSetup, action, signalConfidence, signalAction } =
    extractTradeDecisionSignals(body);

  let positionSizing: TradeDecisionAlertPayload['positionSizing'];
  if (!options?.skipPositionSizing) {
    try {
      positionSizing = await resolveTelegramPositionSizing(fastify, {
        symbol: String(body.symbol || symbol),
        tradingStyle: parseTradingStyle(String(body.tradingStyle || tradingStyle)),
        action,
        signalConfidence,
        signalAction,
        tradeSetup,
      });
    } catch (err) {
      fastify.log.warn(
        { err, symbol, tradingStyle },
        'Telegram position sizing lookup failed — alert will omit account sizing',
      );
    }
  }

  let adaptiveConviction: AdaptiveConvictionInsight | undefined;
  if (
    !options?.skipAdaptiveConviction &&
    (action === 'CE-BUY' || action === 'PE-BUY')
  ) {
    try {
      adaptiveConviction = await computeAdaptiveConviction(fastify, {
        symbol: String(body.symbol || symbol),
        tradingStyle: parseTradingStyle(String(body.tradingStyle || tradingStyle)),
        action,
      });
    } catch (err) {
      fastify.log.warn({ err }, 'Adaptive conviction lookup failed');
    }
  }

  const payload = mapTradeDecisionBodyToPayload(body, symbol, tradingStyle, {
    positionSizing,
    adaptiveConviction,
  });

  rememberCommandTradeDecision(
    commandTradeCacheKey(symbol, tradingStyle, vetoMode, flowMode),
    payload,
  );
  options?.pollContext?.tradeDecisionCache.set(cacheKey, payload);
  if (rawPrice && options?.pollContext) {
    options.pollContext.priceActionCache.set(
      pollPriceActionCacheKey(symbol, tradingStyle),
      rawPrice,
    );
  }
  return payload;
}