import { FastifyInstance } from 'fastify';
import { runBenchmark } from '../benchmark/run-benchmark';
import { BenchmarkAiMode, BenchmarkTradeRow } from '../benchmark/types';
import { TradingStyle } from '../types/trading-style';
import { buildBenchmarkWebAppUrl } from './deck-url';
import { joinTelegramLines, joinTelegramSections } from './message-layout';
import { parseSymbolStyleCommandArgs } from './command-args';
import { toErrorMessage } from '../error-message';

export function parseBenchmarkCommandArgs(
  text: string,
  defaults: { symbol: string; style: TradingStyle },
): {
  symbol: string;
  style: TradingStyle;
  days: number;
  aiMode: BenchmarkAiMode;
  maxTradesPerDay?: number;
} {
  const parts = text.trim().split(/\s+/);
  let days = 14;
  let aiMode: BenchmarkAiMode = 'shadow';
  let maxTradesPerDay: number | undefined;

  for (let i = 1; i < parts.length; i += 1) {
    const raw = parts[i];
    const p = raw.toLowerCase();
    if (p === 'ai-off' || p === 'noai') aiMode = 'off';
    else if (p === 'ai-active' || p === 'ailive') aiMode = 'active';
    else if (p === 'ai-shadow' || p === 'aishadow') aiMode = 'shadow';
    else if (/^max[-:]?\d+$/i.test(raw) || /^\d+max$/i.test(raw)) {
      const match =
        raw.match(/^max[-:]?(\d+)$/i) ?? raw.match(/^(\d+)max$/i);
      if (match) {
        maxTradesPerDay = Math.min(20, Math.max(1, Number(match[1])));
      }
    } else if (/^\d+$/.test(p)) {
      const n = Number(p);
      if (n >= 3) days = Math.min(60, Math.max(3, n));
      else if (n >= 1 && n <= 10) maxTradesPerDay = n;
    }
  }

  const tail = parts
    .filter(
      (part) =>
        !/^\d+$/.test(part) &&
        !part.startsWith('ai') &&
        !/^max[-:]?\d+$/i.test(part) &&
        !/^\d+max$/i.test(part),
    )
    .join(' ');
  const { symbol, style } = parseSymbolStyleCommandArgs(
    `/benchmark ${tail}`.trim(),
    defaults,
  );

  return { symbol, style, days, aiMode, maxTradesPerDay };
}

function formatTradeTable(rows: BenchmarkTradeRow[]): string {
  if (!rows.length) return '<i>No qualifying signals in this window.</i>';

  const lines = rows.slice(0, 8).map((t) => {
    const ai = t.aiAnalysis?.verdict ?? '—';
    return [
      `📅 ${t.sessionDate}`,
      `${t.action} @ ${t.indexEntry}`,
      `SL ${t.stopLoss} · TP ${t.takeProfit1}/${t.takeProfit2}/${t.takeProfit3}`,
      `→ ${t.hitLevel} (${t.pnlR}R)`,
      `🧠 ${t.conviction}% · AI ${ai}`,
    ].join('\n');
  });

  if (rows.length > 8) {
    lines.push(`<i>…and ${rows.length - 8} more in visual report.</i>`);
  }
  return lines.join('\n\n');
}

export async function buildBenchmarkTelegramMessage(
  fastify: FastifyInstance,
  params: {
    text: string;
    defaultSymbol: string;
    defaultStyle: TradingStyle;
  },
): Promise<{ message: string; reportUrl?: string | null; error?: string }> {
  const parsed = parseBenchmarkCommandArgs(params.text, {
    symbol: params.defaultSymbol,
    style: params.defaultStyle,
  });

  try {
    const report = await runBenchmark(fastify, {
      symbol: parsed.symbol,
      tradingStyle: parsed.style,
      days: parsed.days,
      aiMode: parsed.aiMode,
      maxTradesPerDay: parsed.maxTradesPerDay,
      vetoMode: fastify.telegramNotifications.getVetoMode(),
      flowMode: fastify.telegramNotifications.getFlowMode(),
    });

    const b = report.aiComparison.baseline;
    const ai = report.aiComparison.withAi;
    const reportUrl = buildBenchmarkWebAppUrl({
      symbol: parsed.symbol,
      tradingStyle: String(parsed.style),
      days: parsed.days,
      aiMode: parsed.aiMode,
      maxTradesPerDay: parsed.maxTradesPerDay,
    });

    const summary = joinTelegramSections(
      '📐 <b>Benchmark report</b>',
      joinTelegramLines(
        `${parsed.symbol.split(':')[1]?.replace('-INDEX', '') ?? parsed.symbol} · ${parsed.style} · ${parsed.days}d`,
        `AI mode: <b>${parsed.aiMode}</b> · Enter ≥ ${report.params.enterThreshold}%`,
        parsed.maxTradesPerDay != null
          ? `Daily cap: <b>${parsed.maxTradesPerDay}</b> trade${parsed.maxTradesPerDay === 1 ? '' : 's'}/day`
          : 'Daily cap: <b>unlimited</b>',
        '',
        `<b>Engine</b> — ${b.totalSignals} signals · ${b.winRate}% win · ${b.avgPnlR}R avg · ${b.totalPnlR}R total`,
        ai
          ? `<b>${ai.label}</b> — ${ai.totalSignals} signals · ${ai.winRate}% win · ${ai.avgPnlR}R avg`
          : null,
        '',
        `AI agree on wins: ${report.aiComparison.aiAgreeOnWins} · disagree on wins: ${report.aiComparison.aiDisagreeOnWins}`,
        `SL: ${b.stopLossCount} · TP 1.5/2.5/4: ${b.takeProfitCounts['1:1.5']}/${b.takeProfitCounts['1:2.5']}/${b.takeProfitCounts['1:4']} · Trail: ${b.trailFloorCount ?? 0} · Flip: ${b.signalFlipCount}`,
        `Max DD: ${report.capitalSummary.maxDrawdownPercent}% (${report.capitalSummary.maxDrawdownR}R)`,
        '',
        `💰 Paper capital: ₹${(report.capitalSummary.startingCapitalInr / 100000).toFixed(1)}L → <b>₹${(report.capitalSummary.endingCapitalInr / 100000).toFixed(2)}L</b> (${report.capitalSummary.netPnlPercent >= 0 ? '+' : ''}${report.capitalSummary.netPnlPercent}%)`,
        `<i>Risk ${report.capitalSummary.riskPercentPerTrade}%/trade · compounding</i>`,
      ),
      joinTelegramLines(
        '<b>Recent signals</b>',
        formatTradeTable(report.trades),
      ),
      joinTelegramLines(
        '<i>Trailing TP: live 1.5/2.5/4R — hold past 4R until flip.</i>',
        reportUrl ? `<a href="${reportUrl}">📊 Open visual report</a>` : null,
      ),
    );

    return { message: summary, reportUrl };
  } catch (err) {
    fastify.log.warn({ err }, 'benchmark telegram message failed');
    return { message: '', error: toErrorMessage(err) };
  }
}