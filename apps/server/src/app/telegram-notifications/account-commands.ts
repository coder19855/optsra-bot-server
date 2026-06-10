import { FastifyInstance } from 'fastify';
import { PriceActionResponse, TradeAction } from '../types/technical-analysis';
import { TradingStyle } from '../types/trading-style';
import { DecisionAction } from '../types/trade-decision';
import {
  parseSymbolStyleCommandArgs,
  shortIndexLabel,
} from './command-args';
import { TELEGRAM_MSG_RULE } from './message-layout';
import { formatPositionSizingTelegramSection } from './message-formatter';
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

  if (!setup || setup.risk <= 0 || !setup.takeProfits?.length) {
    return [
      `📐 <b>Risk / reward · ${escapeHtml(label)} · ${escapeHtml(params.tradingStyle)}</b>`,
      TELEGRAM_MSG_RULE,
      `⚠️ No active CE/PE setup — RR needs a directional signal with entry and stop.`,
      `${signal.action} · ${signal.confidence}% confidence`,
      signal.vetoReason ? `↳ ${escapeHtml(signal.vetoReason)}` : null,
    ]
      .filter(Boolean)
      .join('\n');
  }

  const tpLines = setup.takeProfits.map((tp) => {
    const dist = Math.abs(tp.price - setup.entry);
    const dir = tp.price >= setup.entry ? '+' : '−';
    return `• <b>${tp.rr}</b> @ ${tp.price.toLocaleString('en-IN')} (${dir}${dist.toFixed(1)} pts · ${tp.multiplier}R)`;
  });

  const lines = [
    `📐 <b>Risk / reward · ${escapeHtml(label)} · ${escapeHtml(params.tradingStyle)}</b>`,
    TELEGRAM_MSG_RULE,
    `${signal.action} · ${signal.confidence}% · spot ${params.priceData.lastPrice.toLocaleString('en-IN')}`,
    `🎯 <b>Entry:</b> ${setup.entry.toLocaleString('en-IN')}`,
    `🛑 <b>Stop:</b> ${setup.stopLoss.toLocaleString('en-IN')} · <b>${setup.risk.toFixed(1)} pts</b> risk`,
    '',
    '<b>Take-profit targets</b>',
    ...tpLines,
  ];

  if (setup.stopAdjusted && setup.stopAdjustReason) {
    lines.push('', `ℹ️ ${escapeHtml(setup.stopAdjustReason)}`);
  }

  lines.push('', '💡 Index levels — map to option premium with your strike delta.');
  return lines.join('\n');
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
        'Fyers token missing or expired — login required for live index setup.',
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
        'Fyers token missing or expired — login required to read account balance.',
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

  const lines = [
    `🏦 <b>Position sizing · ${escapeHtml(label)} · ${escapeHtml(style)}</b>`,
    TELEGRAM_MSG_RULE,
    `${priceData.signal.action} · ${priceData.signal.confidence}% confidence`,
  ];

  if (setup && setup.risk > 0) {
    lines.push(
      `🎯 Entry ${setup.entry.toLocaleString('en-IN')} · stop ${setup.stopLoss.toLocaleString('en-IN')} (${setup.risk.toFixed(1)} pts)`,
    );
  }

  lines.push('', sizingBlock ?? '⚠️ Position sizing unavailable.');
  return { message: lines.join('\n') };
}