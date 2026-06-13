import { AlertFormatMode } from '../types/alert-format';
import { TradeDecisionAlertPayload } from '../types/telegram-notifications';
import {
  ChartPatternDirection,
  ChartPatternId,
  Timeframe,
} from '../types/technical-analysis';
import { joinTelegramLines, joinTelegramSections } from './message-layout';
import { formatScenarioBanner } from './telegram-palette';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function shortSymbol(symbol: string): string {
  const part = symbol.split(':')[1] || symbol;
  return part.replace('-INDEX', '');
}

function humanizePattern(pattern: ChartPatternId): string {
  return pattern.replace(/_/g, ' ');
}

function directionBanner(direction: ChartPatternDirection | undefined): string {
  if (direction === 'bullish') {
    return formatScenarioBanner('bullish', '📐 Chart pattern breakout · BULLISH');
  }
  if (direction === 'bearish') {
    return formatScenarioBanner('bearish', '📐 Chart pattern breakout · BEARISH');
  }
  return formatScenarioBanner('neutral', '📐 Chart pattern breakout');
}

export function formatPatternBreakoutTelegramMessage(params: {
  payload: TradeDecisionAlertPayload;
  alertFormat?: AlertFormatMode;
}): string | null {
  const chart = params.payload.chartPattern;
  if (!chart || chart.pattern === 'none' || chart.status !== 'confirmed') {
    return null;
  }

  const label = shortSymbol(params.payload.symbol);
  const tf = chart.timeframe ?? '15m';
  const patternName = humanizePattern(chart.pattern);
  const headline = directionBanner(chart.direction);

  const identity = joinTelegramLines(
    `<b>${escapeHtml(label)}</b> · ${params.payload.tradingStyle} · <b>${tf}</b>`,
    `✅ <b>${escapeHtml(patternName)}</b> confirmed`,
    chart.neckline != null && chart.neckline > 0
      ? `Neckline ${chart.neckline.toLocaleString('en-IN')}`
      : null,
    `💰 Spot ${params.payload.lastPrice.toLocaleString('en-IN')}`,
  );

  if (params.alertFormat === 'compact') {
    return joinTelegramSections(
      headline,
      identity,
      '📱 PA · structure · strike context → open Deck',
    );
  }

  const context = joinTelegramLines(
    chart.direction === 'bullish'
      ? '📈 Breakout aligns with bullish structure'
      : chart.direction === 'bearish'
        ? '📉 Breakdown aligns with bearish structure'
        : '〰️ Pattern trigger fired — check direction vs your bias',
    `<i>Separate from CE/PE signal flips — pattern confluence only.</i>`,
  );

  return joinTelegramSections(headline, identity, context);
}

export type { Timeframe };