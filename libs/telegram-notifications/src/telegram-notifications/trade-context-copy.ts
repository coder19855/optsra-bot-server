import { TradeDecisionAlertPayload, TradeStructureContext } from '../types/telegram-notifications';
import { DecisionAction, TradeBias } from '../types/trade-decision';
import { DEFAULT_TELEGRAM_VOICE, TelegramVoice } from '../types/telegram-voice';
import {
  translateSidelinesLine,
  translateStructureHeadline,
  translateTimeframeLine,
  translateVetoBlocker,
  vetoSectionFooter,
  vetoSectionTitle,
} from './voice-copy';
import { formatSectionHeader } from './telegram-palette';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export interface VetoSectionInput {
  action: DecisionAction;
  bias: TradeBias;
  conviction: number;
  structureContext?: TradeStructureContext;
  priceAction: TradeDecisionAlertPayload['priceAction'];
}

type TrendRead = 'uptrend' | 'downtrend' | 'chop' | 'flat';

function scoreToTrend(score: number): TrendRead {
  if (score > 0.15) return 'uptrend';
  if (score < -0.15) return 'downtrend';
  if (Math.abs(score) < 0.08) return 'flat';
  return 'chop';
}

const TREND_LABEL: Record<TrendRead, string> = {
  uptrend: 'uptrend',
  downtrend: 'downtrend',
  chop: 'chop',
  flat: 'flat',
};

function trendsAlignWithBias(
  bias: TradeBias,
  scores: Record<'5m' | '15m' | '1h', number>,
): boolean {
  const direction = isDirectionalBias(bias);
  if (!direction) return false;

  const trends = (['5m', '15m', '1h'] as const).map((tf) =>
    scoreToTrend(scores[tf]),
  );

  if (direction === 'bearish') {
    return trends.every((trend) => trend === 'downtrend');
  }
  return trends.every((trend) => trend === 'uptrend');
}

function formatTimeframeSuffix(
  action: DecisionAction,
  bias: TradeBias,
  conviction: number,
  ctx: TradeStructureContext,
): string {
  if (trendsAlignWithBias(bias, ctx.timeframeScores)) {
    const belowBar = conviction < ctx.enterThreshold;
    const vetoed = action === 'NO-TRADE' || action === 'NEUTRAL';

    if (belowBar && vetoed) {
      return 'stack aligned — blocked (conviction & chart)';
    }
    if (belowBar) {
      return 'stack aligned — conviction below enter bar';
    }
    if (vetoed) {
      return 'stack aligned — chart veto active';
    }
    return 'stack aligned';
  }

  const scores = ctx.timeframeScores;
  const mixed = (['5m', '15m', '1h'] as const).some((tf) => {
    const trend = scoreToTrend(scores[tf]);
    return trend === 'chop' || trend === 'flat';
  });

  return mixed
    ? 'mixed structure — waiting for trigger'
    : 'waiting for trigger';
}

/** Multi-timeframe structure summary for sidelines / wait states. */
export function formatTimeframeContextLine(
  action: DecisionAction,
  bias: TradeBias,
  conviction: number,
  ctx: TradeStructureContext,
  voice: TelegramVoice = DEFAULT_TELEGRAM_VOICE,
): string {
  const { primaryTimeframe: primary, timeframeScores: scores } = ctx;
  const h1 = TREND_LABEL[scoreToTrend(scores['1h'])];
  const primaryLabel = TREND_LABEL[scoreToTrend(scores[primary])];
  const m5 = TREND_LABEL[scoreToTrend(scores['5m'])];
  const suffix = formatTimeframeSuffix(action, bias, conviction, ctx);

  let line: string;
  if (primary === '1h') {
    line = `🧭 1h: ${h1} · 5m: ${m5} — ${suffix}`;
  } else if (primary === '5m') {
    line = `🧭 5m: ${primaryLabel} · 1h: ${h1} — ${suffix}`;
  } else {
    line = `🧭 1h: ${h1} · ${primary}: ${primaryLabel} · 5m: ${m5} — ${suffix}`;
  }
  return translateTimeframeLine(line, voice);
}

function isDirectionalBias(bias: TradeBias): 'bullish' | 'bearish' | null {
  if (bias.includes('Bullish')) return 'bullish';
  if (bias.includes('Bearish')) return 'bearish';
  return null;
}

/** Explains NO-TRADE / NEUTRAL when bias still leans one way (CE and PE symmetric). */
export function formatSidelinesContextLine(
  action: DecisionAction,
  bias: TradeBias,
  conviction: number,
  ctx: TradeStructureContext,
  voice: TelegramVoice = DEFAULT_TELEGRAM_VOICE,
): string | null {
  if (action !== 'NO-TRADE' && action !== 'NEUTRAL') return null;

  const direction = isDirectionalBias(bias);
  const primaryWeak = Math.abs(ctx.primaryScore) < 0.12;
  const enter = ctx.enterThreshold;
  const tf = ctx.primaryTimeframe;
  const scoreText = ctx.primaryScore.toFixed(2);

  let line: string | null = null;
  if (direction === 'bearish') {
    line = primaryWeak
      ? `📉 Bearish context — no entry yet (${tf} too weak at ${scoreText}, need ≥${enter}%)`
      : `📉 Bearish context — conviction ${conviction}% below ${enter}% enter bar`;
  } else if (direction === 'bullish') {
    line = primaryWeak
      ? `📈 Bullish context — no entry yet (${tf} too weak at ${scoreText}, need ≥${enter}%)`
      : `📈 Bullish context — conviction ${conviction}% below ${enter}% enter bar`;
  } else if (action === 'NO-TRADE') {
    line = `⏸ No clear edge — ${tf} score ${scoreText}, need ≥${enter}% to enter`;
  }

  return line ? translateSidelinesLine(line, voice) : null;
}

export function formatTradeContextLines(
  action: DecisionAction,
  bias: TradeBias,
  conviction: number,
  ctx: TradeStructureContext | undefined,
  voice: TelegramVoice = DEFAULT_TELEGRAM_VOICE,
): string[] {
  if (!ctx) return [];

  const sidelines = formatSidelinesContextLine(action, bias, conviction, ctx, voice);
  const showTimeframes =
    action === 'NO-TRADE' || action === 'NEUTRAL' || conviction < ctx.enterThreshold;

  return [
    sidelines,
    showTimeframes
      ? formatTimeframeContextLine(action, bias, conviction, ctx, voice)
      : null,
  ].filter((line): line is string => Boolean(line));
}

function isChartVetoed(
  action: DecisionAction,
  pa: TradeDecisionAlertPayload['priceAction'],
): boolean {
  const structural =
    pa.structuralAction === 'CE-BUY' || pa.structuralAction === 'PE-BUY';

  return (
    pa.confidence === 0 ||
    (action === 'NO-TRADE' &&
      (pa.action === 'NO-TRADE' || pa.action === 'CE-BUY' || pa.action === 'PE-BUY' || structural))
  );
}

function formatStructureVetoHeadline(
  bias: TradeBias,
  ctx: TradeStructureContext | undefined,
  pa: TradeDecisionAlertPayload['priceAction'],
): string | null {
  const direction = isDirectionalBias(bias);
  const aligned = ctx ? trendsAlignWithBias(bias, ctx.timeframeScores) : false;
  const structural = pa.structuralAction;
  const bearishRead =
    structural === 'PE-BUY' || pa.action === 'PE-BUY' || direction === 'bearish';
  const bullishRead =
    structural === 'CE-BUY' || pa.action === 'CE-BUY' || direction === 'bullish';

  if (aligned && direction === 'bearish') {
    const setup =
      structural === 'PE-BUY' || pa.action === 'PE-BUY'
        ? ' · PE was the structural read'
        : '';
    return `📉 Market bearish — all timeframes downtrend${setup}`;
  }

  if (aligned && direction === 'bullish') {
    const setup =
      structural === 'CE-BUY' || pa.action === 'CE-BUY'
        ? ' · CE was the structural read'
        : '';
    return `📈 Market bullish — all timeframes uptrend${setup}`;
  }

  if (structural === 'PE-BUY' || (bearishRead && !bullishRead)) {
    return '📉 Bearish structure — PE setup was on the table';
  }

  if (structural === 'CE-BUY' || (bullishRead && !bearishRead)) {
    return '📈 Bullish structure — CE setup was on the table';
  }

  if (direction === 'bearish') {
    return '📉 Bearish context — entry not cleared';
  }

  if (direction === 'bullish') {
    return '📈 Bullish context — entry not cleared';
  }

  return null;
}

/** Clear veto block when structure leans one way but entry is blocked. */
export function formatVetoSection(
  input: VetoSectionInput,
  voice: TelegramVoice = DEFAULT_TELEGRAM_VOICE,
): string | null {
  const { action, bias, conviction, structureContext: ctx, priceAction: pa } = input;

  if (action !== 'NO-TRADE' && action !== 'NEUTRAL') return null;

  const direction = isDirectionalBias(bias);
  const aligned = ctx ? trendsAlignWithBias(bias, ctx.timeframeScores) : false;
  const structural =
    pa.structuralAction === 'CE-BUY' || pa.structuralAction === 'PE-BUY';
  const belowBar = ctx ? conviction < ctx.enterThreshold : false;
  const chartVetoed = isChartVetoed(action, pa);

  const hasDirectionalContext =
    direction != null || structural || aligned || chartVetoed;
  if (!hasDirectionalContext) return null;

  const blockers: string[] = [];

  if (belowBar && ctx) {
    blockers.push(
      `Conviction ${conviction}% below ${ctx.enterThreshold}% enter bar`,
    );
  }

  if (chartVetoed) {
    if (pa.vetoReason) {
      blockers.push(pa.vetoReason);
    } else if (pa.structuralAction === 'PE-BUY' || pa.action === 'PE-BUY') {
      const was =
        pa.confidenceBeforeDecay != null && pa.confidenceBeforeDecay > 0
          ? ` (was ${pa.confidenceBeforeDecay}% before decay)`
          : '';
      blockers.push(`Momentum decay vetoed bearish chart${was}`);
    } else if (pa.structuralAction === 'CE-BUY' || pa.action === 'CE-BUY') {
      const was =
        pa.confidenceBeforeDecay != null && pa.confidenceBeforeDecay > 0
          ? ` (was ${pa.confidenceBeforeDecay}% before decay)`
          : '';
      blockers.push(`Momentum decay vetoed bullish chart${was}`);
    } else {
      blockers.push('Chart vetoed — momentum decay');
    }
  }

  if (blockers.length === 0) return null;

  const structureLine = translateStructureHeadline(
    formatStructureVetoHeadline(bias, ctx, pa) ?? '',
    voice,
  );
  if (!structureLine) return null;

  return [
    formatSectionHeader('warning', vetoSectionTitle(voice), '⛔'),
    structureLine,
    ...blockers.map((line) => `• ${escapeHtml(translateVetoBlocker(line, voice))}`),
    vetoSectionFooter(voice),
  ].join('\n');
}