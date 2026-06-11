import { FastifyInstance } from 'fastify';
import { PriceActionResponse, TradeAction } from '../types/technical-analysis';
import { TradingStyle } from '../types/trading-style';
import { DecisionAction } from '../types/trade-decision';
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
import { resolveTelegramPositionSizing } from './position-sizing-context';

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

async function fetchLivePriceAction(
  fastify: FastifyInstance,
  symbol: string,
  tradingStyle: TradingStyle,
): Promise<PriceActionResponse | null> {
  const res = await fastify.inject({
    method: 'GET',
    url: `/api/technical-analysis?symbol=${encodeURIComponent(symbol)}&tradingStyle=${tradingStyle}`,
  });
  if (res.statusCode !== 200) return null;
  return JSON.parse(res.body) as PriceActionResponse;
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

  const sessionReady = await fastify.ensureFyersSession();
  if (!sessionReady) {
    return {
      message: '',
      error:
        'Fyers session’s asleep — log in for live index setup.',
    };
  }

  const priceData = await fetchLivePriceAction(fastify, symbol, style);
  if (!priceData) {
    return {
      message: '',
      error: `Could not load technical analysis for ${shortIndexLabel(symbol)}.`,
    };
  }

  return {
    message: formatRiskRewardTelegramMessage({
      priceData,
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

  const sessionReady = await fastify.ensureFyersSession({ verifyWithApi: true });
  if (!sessionReady) {
    return {
      message: '',
      error:
        'Fyers session’s asleep — log in to read your balance.',
    };
  }

  const priceData = await fetchLivePriceAction(fastify, symbol, style);
  if (!priceData) {
    return {
      message: '',
      error: `Could not load trade setup for ${shortIndexLabel(symbol)}.`,
    };
  }

  const action = mapSignalToDecisionAction(priceData.signal.action);
  const sizing = await resolveTelegramPositionSizing(fastify, {
    symbol,
    tradingStyle: style,
    action,
    signalConfidence: priceData.signal.confidence,
    signalAction: priceData.signal.action,
    tradeSetup: priceData.tradeSetup ?? null,
  });

  const label = shortIndexLabel(symbol);
  const sizingBlock = formatPositionSizingTelegramSection(sizing);
  const setup = priceData.tradeSetup;

  const actionScenario = scenarioForAction(action);
  const setupLine =
    setup && setup.risk > 0
      ? `🎯 ${setup.entry.toLocaleString('en-IN')} · 🛑 ${setup.stopLoss.toLocaleString('en-IN')} (${setup.risk.toFixed(1)}pts)`
      : null;

  return {
    message: joinTelegramSections(
      formatScenarioBanner(actionScenario, `Size · ${escapeHtml(label)} · ${style}`),
      `${priceData.signal.action} ${priceData.signal.confidence}%`,
      setupLine,
      sizingBlock ?? '⚠️ Sizing unavailable.',
    ),
  };
}