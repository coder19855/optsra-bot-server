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
import { fetchTradeDecisionAlert } from './trade-decision-fetch';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatInr(value: number): string {
  return value.toLocaleString('en-IN');
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

  const payload = await fetchTradeDecisionAlert(fastify, symbol, style, {
    vetoMode: fastify.telegramNotifications.getVetoMode(),
    flowMode: fastify.telegramNotifications.getFlowMode(),
    sessionVerified: true,
    skipPositionSizing: true,
    skipAdaptiveConviction: true,
  });
  if (!payload) {
    return {
      message: '',
      error: `Could not load strike analysis for ${shortIndexLabel(symbol)}.`,
    };
  }

  const label = shortIndexLabel(payload.symbol || symbol);
  const rawOption = (payload._decisionBody?._debug as { rawOption?: OptionMetricsResponse } | undefined)
    ?.rawOption;
  const greeksPair = rawOption?.greeksStrikeInsights ?? {
    CE: null,
    PE: null,
  };
  const thresholds = payload._decisionBody?.convictionThresholds as
    | { enter?: number }
    | undefined;
  const enterThreshold = thresholds?.enter ?? 55;
  const belowThreshold = payload.conviction < enterThreshold;

  let exactStrikes: {
    CE: ExactStrikeRecommendation | null;
    PE: ExactStrikeRecommendation | null;
  } = { CE: null, PE: null };

  if (payload.action === 'CE-BUY' && payload.exactStrikeRecommendation) {
    exactStrikes.CE = payload.exactStrikeRecommendation;
  } else if (
    payload.action === 'PE-BUY' &&
    payload.exactStrikeRecommendation
  ) {
    exactStrikes.PE = payload.exactStrikeRecommendation;
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