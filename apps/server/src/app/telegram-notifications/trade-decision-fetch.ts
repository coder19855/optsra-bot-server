import { FastifyInstance } from 'fastify';
import { computeAdaptiveConviction } from './adaptive-conviction';
import { buildAlertWhyContext } from './why-context-builder';
import { GreeksStrikeInsight } from '../types/greeks-strike-insight';
import { ExactStrikeRecommendation } from '../types/exact-strike-recommendation';
import { AdaptiveConvictionInsight } from '../types/adaptive-conviction';
import { AlertWhyContext } from '../types/alert-intelligence';
import { PriceActionResponse } from '../types/technical-analysis';
import { TradingStyle } from '../types/trading-style';
import { TradeDecisionAlertPayload } from '../types/telegram-notifications';
import { DecisionAction } from '../types/trade-decision';
import { resolveTelegramPositionSizing } from './position-sizing-context';

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
): Promise<TradeDecisionAlertPayload | null> {
  const res = await fastify.inject({
    method: 'GET',
    url: `/api/trade-decision?symbol=${encodeURIComponent(symbol)}&tradingStyle=${tradingStyle}`,
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

  const paAction = (overallSignal?.action as string) || 'NO-TRADE';
  const paConfidence = Number(overallSignal?.confidence ?? 0);

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

  return {
    symbol: String(body.symbol || symbol),
    tradingStyle: parseTradingStyle(String(body.tradingStyle || tradingStyle)),
    lastPrice: Number(body.lastPrice ?? 0),
    action,
    bias: body.bias as TradeDecisionAlertPayload['bias'],
    conviction: Number(body.conviction ?? 0),
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
  };
}