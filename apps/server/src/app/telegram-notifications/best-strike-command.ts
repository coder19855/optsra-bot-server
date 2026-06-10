import { FastifyInstance } from 'fastify';
import { buildExactStrikeRecommendationPair } from '../option-flow/exact-strike-recommender';
import { OptionMetricsResponse } from '../types/options';
import { ExactStrikeRecommendation } from '../types/exact-strike-recommendation';
import {
  GreeksStrikeInsight,
  GreeksStrikeProfile,
} from '../types/greeks-strike-insight';
import { DecisionAction } from '../types/trade-decision';
import { TradingStyle } from '../types/trading-style';
import {
  parseBestStrikeCommandArgs,
  shortIndexLabel,
} from './command-args';
import {
  formatGreeksStrikeSection,
} from './message-formatter';
import { TELEGRAM_MSG_RULE } from './message-layout';

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
  const res = await fastify.inject({
    method: 'GET',
    url: `/api/trade-decision?symbol=${encodeURIComponent(symbol)}&tradingStyle=${tradingStyle}`,
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

function gammaRank(level: GreeksStrikeProfile['gammaLevel']): number {
  if (level === 'high') return 3;
  if (level === 'moderate') return 2;
  return 1;
}

function formatExplosionWatch(
  insight: GreeksStrikeInsight | null | undefined,
): string | null {
  if (!insight?.profiles.length) return null;

  const ranked = [...insight.profiles].sort(
    (a, b) => gammaRank(b.gammaLevel) - gammaRank(a.gammaLevel),
  );
  const top = ranked[0];
  if (!top) return null;

  const icon = top.gammaLevel === 'high' ? '⚡' : top.gammaLevel === 'moderate' ? '〰️' : '💤';
  const speed =
    top.gammaLevel === 'high'
      ? 'Rocket fuel gamma — premium can pop hard if spot breaks.'
      : top.gammaLevel === 'moderate'
        ? 'Decent gamma — needs a clean push to pay.'
        : 'Sleepy gamma — slower premium; better for grindy trends or ITM carry.';

  const lines = [
    `${icon} <b>About to pop? · ${insight.optionSide}</b>`,
    `<b>${top.moneyness}</b> ${formatInr(top.strike)} · ${speed}`,
    `↳ ${escapeHtml(top.consequence)}`,
  ];

  const runner = ranked.find(
    (profile) =>
      profile.moneyness !== top.moneyness && profile.gammaLevel === 'high',
  );
  if (runner) {
    lines.push(
      `↳ Also hot: <b>${runner.moneyness}</b> ${formatInr(runner.strike)} (${runner.gammaLevel} gamma)`,
    );
  }

  return lines.join('\n');
}

function formatExactStrikePick(
  strike: ExactStrikeRecommendation | null | undefined,
  label: string,
): string | null {
  if (!strike) return null;

  const move =
    strike.expectedPremiumMove50Pts != null
      ? ` · ~₹${strike.expectedPremiumMove50Pts.toFixed(1)}/50pts`
      : '';

  return [
    `📌 <b>${label}</b>`,
    `<code>${escapeHtml(strike.fyersSymbol)}</code>`,
    `${strike.moneyness} @ ${formatInr(strike.strike)} · prem ₹${strike.premium.toFixed(1)} · Δ ${strike.delta?.toFixed(2) ?? '—'}${move}`,
    `↳ ${escapeHtml(strike.rationale)}`,
  ].join('\n');
}

function formatNeutralStrikeOverview(params: {
  greeksInsights: { CE: GreeksStrikeInsight | null; PE: GreeksStrikeInsight | null };
  exactStrikes: { CE: ExactStrikeRecommendation | null; PE: ExactStrikeRecommendation | null };
}): string[] {
  const sections: string[] = [
    '🤷 No clear CE/PE lean — scouting both sides below.',
    'Zoom in with <code>/beststrike CE</code> or <code>/beststrike PE</code>.',
  ];

  for (const side of ['CE', 'PE'] as const) {
    const insight = params.greeksInsights[side];
    const explosion = formatExplosionWatch(insight);
    const pick = formatExactStrikePick(
      params.exactStrikes[side],
      `If ${side} rips · engine’s pick`,
    );
    const greeks = formatGreeksStrikeSection(insight ?? undefined);

    if (explosion) sections.push('', explosion);
    if (pick) sections.push('', pick);
    if (greeks) sections.push('', greeks);
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
  const lines: string[] = [
    `🎯 <b>Strike scout · ${escapeHtml(label)} · ${escapeHtml(style)}</b>`,
    TELEGRAM_MSG_RULE,
    `${payload.action} · <b>${payload.conviction}%</b> conviction · spot ${formatInr(payload.lastPrice)}`,
  ];

  if (rawOption?.ivRegime) {
    lines.push(`🌡 IV: ${escapeHtml(rawOption.ivRegime)}`);
  }

  if (!activeSide) {
    lines.push(...formatNeutralStrikeOverview({ greeksInsights: greeksPair, exactStrikes }));
    lines.push(
      '',
      '💡 ATM / ITM / OTM near spot — high gamma ⚡ = fastest premium fireworks.',
    );
    return { message: lines.join('\n') };
  }

  const insight =
    greeksPair[activeSide] ??
    payload.optionFlow?.greeksStrikeInsight ??
    null;
  const explosion = formatExplosionWatch(insight);
  const enginePick = formatExactStrikePick(
    exactStrikes[activeSide],
    'Engine’s pick for this read',
  );
  const greeks = formatGreeksStrikeSection(insight ?? undefined);

  if (explosion) lines.push('', explosion);
  if (enginePick) lines.push('', enginePick);
  if (greeks) lines.push('', greeks);

  if (!explosion && !enginePick && !greeks) {
    lines.push(
      '',
      '⚠️ Chain or Greeks ghosted us — retry in market hours with Fyers logged in.',
    );
  } else {
    lines.push(
      '',
      '💡 <b>Doing well</b> → engine pick above (your style + conviction + IV).',
      '💡 <b>About to pop</b> → high gamma ⚡ — first to dance if spot breaks clean.',
    );
  }

  return { message: lines.join('\n') };
}