import { FastifyInstance } from 'fastify';
import { PriceActionResponse, TradeAction } from '../types/technical-analysis';
import { TradingStyle } from '../types/trading-style';
import { DecisionAction } from '../types/trade-decision';
import { TradeDecisionAlertPayload } from '../types/telegram-notifications';
import {
  parseSymbolStyleCommandArgs,
  shortIndexLabel,
} from './command-args';
import { formatPositionSizingTelegramSection } from './message-formatter';
import { joinTelegramLines, joinTelegramSections } from './message-layout';
import {
  formatScenarioBanner,
  scenarioForAction,
} from './telegram-palette';
import { fetchTradeDecisionAlert } from './trade-decision-fetch';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function mapSignalToDecisionAction(action: TradeAction): DecisionAction {
  if (action === 'CE-BUY') return 'CE-BUY';
  if (action === 'PE-BUY') return 'PE-BUY';
  return 'NO-TRADE';
}

function payloadToPriceActionView(
  payload: TradeDecisionAlertPayload,
): PriceActionResponse {
  const rawPrice = payload._decisionBody?._debug as
    | { rawPrice?: PriceActionResponse }
    | undefined;
  if (rawPrice?.rawPrice) {
    return rawPrice.rawPrice;
  }

  return {
    symbol: payload.symbol,
    lastPrice: payload.lastPrice,
    signal: {
      action: payload.priceAction.action,
      confidence: payload.priceAction.confidence,
      vetoReason: payload.priceAction.vetoReason,
    },
    tradeSetup: payload.tradeSetup ?? undefined,
  } as PriceActionResponse;
}

async function fetchTradeDecisionForCommand(
  fastify: FastifyInstance,
  symbol: string,
  tradingStyle: TradingStyle,
  enrichment: {
    skipPositionSizing?: boolean;
    skipAdaptiveConviction?: boolean;
    verifyWithApi?: boolean;
  } = {},
): Promise<TradeDecisionAlertPayload | null> {
  const sessionReady = await fastify.ensureFyersSession(
    enrichment.verifyWithApi ? { verifyWithApi: true } : undefined,
  );
  if (!sessionReady) {
    return null;
  }

  return fetchTradeDecisionAlert(fastify, symbol, tradingStyle, {
    vetoMode: fastify.telegramNotifications.getVetoMode(),
    flowMode: fastify.telegramNotifications.getFlowMode(),
    sessionVerified: true,
    skipPositionSizing: enrichment.skipPositionSizing,
    skipAdaptiveConviction: enrichment.skipAdaptiveConviction,
  });
}

export function formatRiskRewardTelegramMessage(params: {
  priceData: PriceActionResponse;
  symbol: string;
  tradingStyle: TradingStyle;
}): string {
  const label = shortIndexLabel(params.symbol);
  const setup = params.priceData.tradeSetup;
  const signal = params.priceData.signal;

  const actionScenario = scenarioForAction(mapSignalToDecisionAction(signal.action));

  if (!setup || setup.risk <= 0 || !setup.takeProfits?.length) {
    return joinTelegramSections(
      formatScenarioBanner(actionScenario, `RR · ${escapeHtml(label)} · ${params.tradingStyle}`),
      joinTelegramLines(
        `${signal.action} ${signal.confidence}%${signal.vetoReason ? ` — ${escapeHtml(signal.vetoReason)}` : ''}`,
        '💤 No entry/stop setup yet.',
      ),
    );
  }

  const tpLines = setup.takeProfits.map((tp) => {
    const dist = Math.abs(tp.price - setup.entry);
    return `<b>${tp.rr}</b> @ ${tp.price.toLocaleString('en-IN')} (+${dist.toFixed(0)}pts)`;
  });

  const setupBlock = joinTelegramLines(
    `🎯 Entry ${setup.entry.toLocaleString('en-IN')} · 🛑 SL ${setup.stopLoss.toLocaleString('en-IN')} (${setup.risk.toFixed(1)}pts)`,
    `🏁 ${tpLines.join(' · ')}`,
    setup.stopAdjusted && setup.stopAdjustReason
      ? `ℹ️ ${escapeHtml(setup.stopAdjustReason)}`
      : null,
  );

  return joinTelegramSections(
    formatScenarioBanner(actionScenario, `RR · ${escapeHtml(label)} · ${params.tradingStyle}`),
    `${signal.action} ${signal.confidence}% · spot ${params.priceData.lastPrice.toLocaleString('en-IN')}`,
    setupBlock,
  );
}

export async function buildRiskRewardTelegramMessage(
  fastify: FastifyInstance,
  params: {
    text: string;
    defaultSymbol: string;
    defaultStyle: TradingStyle;
  },
): Promise<{ message: string; error?: string }> {
  const { symbol, style } = parseSymbolStyleCommandArgs(params.text, {
    symbol: params.defaultSymbol,
    style: params.defaultStyle,
  });

  const payload = await fetchTradeDecisionForCommand(fastify, symbol, style, {
    skipPositionSizing: true,
    skipAdaptiveConviction: true,
  });
  if (!payload) {
    return {
      message: '',
      error:
        'Fyers session’s asleep — log in for live index setup.',
    };
  }

  return {
    message: formatRiskRewardTelegramMessage({
      priceData: payloadToPriceActionView(payload),
      symbol,
      tradingStyle: style,
    }),
  };
}

export async function buildPositionSizingTelegramMessage(
  fastify: FastifyInstance,
  params: {
    text: string;
    defaultSymbol: string;
    defaultStyle: TradingStyle;
  },
): Promise<{ message: string; error?: string }> {
  const { symbol, style } = parseSymbolStyleCommandArgs(params.text, {
    symbol: params.defaultSymbol,
    style: params.defaultStyle,
  });

  const payload = await fetchTradeDecisionForCommand(fastify, symbol, style, {
    skipAdaptiveConviction: true,
    verifyWithApi: true,
  });
  if (!payload) {
    return {
      message: '',
      error:
        'Fyers session’s asleep — log in to read your balance.',
    };
  }

  const label = shortIndexLabel(symbol);
  const sizingBlock = formatPositionSizingTelegramSection(payload.positionSizing);
  const setup = payload.tradeSetup;
  const actionScenario = scenarioForAction(payload.action);
  const setupLine =
    setup && setup.risk > 0
      ? `🎯 ${setup.entry.toLocaleString('en-IN')} · 🛑 ${setup.stopLoss.toLocaleString('en-IN')} (${setup.risk.toFixed(1)}pts)`
      : null;

  return {
    message: joinTelegramSections(
      formatScenarioBanner(actionScenario, `Size · ${escapeHtml(label)} · ${style}`),
      `${payload.priceAction.action} ${payload.priceAction.confidence}%`,
      setupLine,
      sizingBlock ?? '⚠️ Sizing unavailable.',
    ),
  };
}