import { FastifyInstance } from 'fastify';
import { computeAdaptiveConviction } from './adaptive-conviction';
import { buildAlertWhyContext } from './why-context-builder';
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
import { resolveTelegramPositionSizing } from './position-sizing-context';

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

export async function fetchTradeDecisionAlert(
  fastify: FastifyInstance,
  symbol: string,
  tradingStyle: TradingStyle,
  options?: {
    vetoMode?: import('../types/veto-mode').VetoMode;
    /** @deprecated use vetoMode */
    vetoOff?: boolean;
  },
): Promise<TradeDecisionAlertPayload | null> {
  const vetoMode =
    options?.vetoMode ?? (options?.vetoOff ? 'off' : 'strict');
  const vetoQuery = `&vetoMode=${encodeURIComponent(vetoMode)}`;
  const res = await fastify.inject({
    method: 'GET',
    url: `/api/trade-decision?symbol=${encodeURIComponent(symbol)}&tradingStyle=${tradingStyle}${vetoQuery}`,
  });

  if (res.statusCode !== 200) {
    throw new Error(
      `trade-decision failed for ${symbol} (${tradingStyle}): HTTP ${res.statusCode}`,
    );
  }

  const body = JSON.parse(res.body) as Record<string, unknown>;
  const priceAction = body.priceAction as Record<string, unknown> | undefined;
  const overallSignal = priceAction?.overallSignal as
    | Record<string, unknown>
    | undefined;
  const tradeGuidance = body.tradeGuidance as Record<string, unknown> | undefined;
  const optionFlow = body.optionFlow as Record<string, unknown> | undefined;
  const strategies = (body.recommendedStrategies as Array<Record<string, unknown>>) || [];

  let paAction = (overallSignal?.action as string) || 'NO-TRADE';
  let paConfidence = Number(overallSignal?.confidence ?? 0);
  const structuralAction = overallSignal?.structuralAction as string | undefined;
  const vetoReason = overallSignal?.vetoReason
    ? String(overallSignal.vetoReason)
    : undefined;
  const confidenceBeforeDecay =
    overallSignal?.confidenceBeforeDecay != null
      ? Number(overallSignal.confidenceBeforeDecay)
      : undefined;

  // Chart veto: avoid showing "PE-BUY · 0%" when momentum decay zeroed confidence.
  if (
    paConfidence === 0 &&
    (paAction === 'CE-BUY' || paAction === 'PE-BUY')
  ) {
    paAction = 'NO-TRADE';
  }

  let action = (body.action as DecisionAction) || 'NO-TRADE';
  if (!body.action) {
    if (paAction === 'CE-BUY' || paAction === 'PE-BUY') {
      action = paAction;
    } else if (String(body.bias).includes('Neutral')) {
      action = 'NEUTRAL';
    }
  }

  const debug = body._debug as { rawPrice?: PriceActionResponse } | undefined;
  const rawPrice = debug?.rawPrice;
  const tradeSetup = rawPrice?.tradeSetup ?? null;
  const signalConfidence = Number(
    rawPrice?.signal?.confidence ?? paConfidence,
  );
  const signalAction = String(rawPrice?.signal?.action ?? paAction);

  let positionSizing: TradeDecisionAlertPayload['positionSizing'];
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

  const whyContext: AlertWhyContext = buildAlertWhyContext(body);
  const exactStrikeRecommendation =
    (optionFlow?.exactStrikeRecommendation as ExactStrikeRecommendation | null) ??
    undefined;

  let adaptiveConviction: AdaptiveConvictionInsight | undefined;
  if (action === 'CE-BUY' || action === 'PE-BUY') {
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

  const structureContext = buildStructureContext(body, tradingStyle);

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
    adaptiveConviction,
    recommendedStrategies: strategies.map((s) => ({
      strategy: String(s.strategy ?? ''),
      risk: s.risk ? String(s.risk) : undefined,
      confidenceScore:
        s.confidenceScore != null ? Number(s.confidenceScore) : undefined,
      reason: s.reason ? String(s.reason) : undefined,
      executionHint: s.executionHint ? String(s.executionHint) : undefined,
    })),
    positionSizing,
    tradeSetup,
    momentumDecayPercent: rawPrice?.momentumDecay?.decayPercent ?? null,
  };
}