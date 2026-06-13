import { FastifyInstance } from 'fastify';
import { buildExactStrikeRecommendationPair } from '../option-flow/exact-strike-recommender';
import { OptionMetricsResponse } from '../types/options';
import { ExactStrikeRecommendation } from '../types/exact-strike-recommendation';
import { GreeksStrikeInsight } from '../types/greeks-strike-insight';
import { DecisionAction } from '../types/trade-decision';
import { TradingStyle } from '../types/trading-style';
import {
  parseBestStrikeCommandArgs,
  shortIndexLabel,
} from './command-args';
import {
  formatGreeksStrikeSection,
} from './message-formatter';
import { joinTelegramLines, joinTelegramSections } from './message-layout';
import {
  formatScenarioBanner,
  scenarioForAction,
  tintLine,
} from './telegram-palette';
import {
  formatEnginePickCallout,
  formatGammaBlastCallout,
} from './strike-callouts';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatInr(value: number): string {
  return value.toLocaleString('en-IN');
}

interface TradeDecisionPayload {
  symbol: string;
  lastPrice: number;
  tradingStyle: TradingStyle;
  action: DecisionAction;
  conviction: number;
  optionFlow?: {
    ivRegime?: string;
    greeksStrikeInsight?: GreeksStrikeInsight | null;
    exactStrikeRecommendation?: ExactStrikeRecommendation | null;
  };
  convictionThresholds?: { enter?: number };
  _debug?: {
    rawOption?: OptionMetricsResponse;
  };
}

async function fetchTradeDecisionPayload(
  fastify: FastifyInstance,
  symbol: string,
  tradingStyle: TradingStyle,
): Promise<TradeDecisionPayload | null> {
  const vetoMode = fastify.telegramNotifications?.getVetoMode?.() ?? 'strict';
  const flowMode = fastify.telegramNotifications?.getFlowMode?.() ?? 'blend';
  const vetoQuery = `&vetoMode=${encodeURIComponent(vetoMode)}`;
  const flowQuery = `&flowMode=${encodeURIComponent(flowMode)}`;
  const res = await fastify.inject({
    method: 'GET',
    url: `/api/trade-decision?symbol=${encodeURIComponent(symbol)}&tradingStyle=${tradingStyle}${vetoQuery}${flowQuery}`,
  });

  if (res.statusCode !== 200) return null;
  return JSON.parse(res.body) as TradeDecisionPayload;
}

function resolveActiveSide(
  action: DecisionAction,
  sideOverride?: 'CE' | 'PE',
): 'CE' | 'PE' | null {
  if (sideOverride) return sideOverride;
  if (action === 'CE-BUY') return 'CE';
  if (action === 'PE-BUY') return 'PE';
  return null;
}

function formatNeutralStrikeOverview(params: {
  greeksInsights: { CE: GreeksStrikeInsight | null; PE: GreeksStrikeInsight | null };
  exactStrikes: { CE: ExactStrikeRecommendation | null; PE: ExactStrikeRecommendation | null };
  spot: number;
}): string[] {
  const sections: string[] = [
    '🤷 No lean — try <code>/beststrike CE</code> or <code>PE</code>',
  ];

  for (const side of ['CE', 'PE'] as const) {
    const insight = params.greeksInsights[side];
    const blast =
      insight != null
        ? formatGammaBlastCallout({ insight, spot: params.spot })
        : null;
    const pick = params.exactStrikes[side]
      ? formatEnginePickCallout(
          params.exactStrikes[side],
          `<b>ENGINE PICK · ${side}</b>`,
        )
      : null;

    if (blast) sections.push('', blast);
    if (pick) sections.push('', pick);
  }

  return sections;
}

export async function buildBestStrikeTelegramMessage(
  fastify: FastifyInstance,
  params: {
    text: string;
    defaultSymbol: string;
    defaultStyle: TradingStyle;
  },
): Promise<{ message: string; error?: string }> {
  const { symbol, style, side } = parseBestStrikeCommandArgs(params.text, {
    symbol: params.defaultSymbol,
    style: params.defaultStyle,
  });

  const sessionReady = await fastify.ensureFyersSession({ verifyWithApi: true });
  if (!sessionReady) {
    return {
      message: '',
      error:
        'Fyers session’s asleep — log in for live option chain & Greeks.',
    };
  }

  const payload = await fetchTradeDecisionPayload(fastify, symbol, style);
  if (!payload) {
    return {
      message: '',
      error: `Could not load strike analysis for ${shortIndexLabel(symbol)}.`,
    };
  }

  const label = shortIndexLabel(payload.symbol || symbol);
  const rawOption = payload._debug?.rawOption;
  const greeksPair = rawOption?.greeksStrikeInsights ?? {
    CE: null,
    PE: null,
  };
  const enterThreshold = payload.convictionThresholds?.enter ?? 55;
  const belowThreshold = payload.conviction < enterThreshold;

  let exactStrikes: {
    CE: ExactStrikeRecommendation | null;
    PE: ExactStrikeRecommendation | null;
  } = { CE: null, PE: null };

  if (payload.action === 'CE-BUY' && payload.optionFlow?.exactStrikeRecommendation) {
    exactStrikes.CE = payload.optionFlow.exactStrikeRecommendation;
  } else if (
    payload.action === 'PE-BUY' &&
    payload.optionFlow?.exactStrikeRecommendation
  ) {
    exactStrikes.PE = payload.optionFlow.exactStrikeRecommendation;
  } else if (rawOption?.optionChainNearby?.length) {
    exactStrikes = buildExactStrikeRecommendationPair(
      rawOption.optionChainNearby,
      rawOption.spotSymbol || symbol,
      style,
      payload.conviction,
      greeksPair,
      rawOption.ivRegime,
      belowThreshold,
    );
  }

  const activeSide = resolveActiveSide(payload.action, side);
  const actionScenario = scenarioForAction(payload.action);
  const header = joinTelegramLines(
    formatScenarioBanner(actionScenario, `Strike scout · ${escapeHtml(label)} · ${escapeHtml(style)}`),
    tintLine(
      actionScenario,
      `${payload.action} · <b>${payload.conviction}%</b> conviction · spot ${formatInr(payload.lastPrice)}`,
    ),
    rawOption?.ivRegime
      ? tintLine('info', `🌡 IV: ${escapeHtml(rawOption.ivRegime)}`)
      : null,
  );

  if (!activeSide) {
    const neutralOverview = formatNeutralStrikeOverview({
      greeksInsights: greeksPair,
      exactStrikes,
      spot: payload.lastPrice,
    }).join('\n');
    return { message: joinTelegramSections(header, neutralOverview) };
  }

  const insight =
    greeksPair[activeSide] ??
    payload.optionFlow?.greeksStrikeInsight ??
    null;
  const blast =
    insight != null
      ? formatGammaBlastCallout({ insight, spot: payload.lastPrice })
      : null;
  const enginePick = exactStrikes[activeSide]
    ? formatEnginePickCallout(exactStrikes[activeSide])
    : null;
  const greeks =
    blast || enginePick
      ? null
      : formatGreeksStrikeSection(insight ?? undefined);

  const fallback =
    !blast && !enginePick && !greeks
      ? '⚠️ No chain data — retry in market hours.'
      : null;

  return {
    message: joinTelegramSections(header, blast, enginePick, greeks, fallback),
  };
}