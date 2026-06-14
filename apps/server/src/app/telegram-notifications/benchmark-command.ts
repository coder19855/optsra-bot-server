import { FastifyInstance } from 'fastify';
import { runBenchmark } from '../benchmark/run-benchmark';
import { BenchmarkAiMode, BenchmarkTradeRow } from '../benchmark/types';
import { TradingStyle } from '../types/trading-style';
import { buildBenchmarkWebAppUrl } from './deck-url';
import { joinTelegramLines, joinTelegramSections } from './message-layout';
import { parseSymbolStyleCommandArgs, shortIndexLabel } from './command-args';
import { toErrorMessage } from '../error-message';
import { tradingStyleLabel } from './style-command';
import { flowModeLabel, FlowMode } from '../types/flow-mode';
import { VetoMode, vetoModeLabel } from '../types/veto-mode';

/** Bare `/benchmark` (or `help` / `options`) — show presets, do not run replay. */
export function isBenchmarkHelpRequest(text: string): boolean {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return true;

  const cmd = parts[0].toLowerCase().split('@')[0];
  if (cmd !== '/benchmark' && cmd !== '/backtest') return false;
  if (parts.length === 1) return true;

  const hint = parts[1].toLowerCase();
  return (
    hint === 'help' ||
    hint === 'options' ||
    hint === 'option' ||
    hint === 'status' ||
    hint === 'hints'
  );
}

export function formatBenchmarkHelpMessage(params: {
  symbol: string;
  style: TradingStyle;
  vetoMode: VetoMode;
  flowMode: FlowMode;
}): string {
  const sym = shortIndexLabel(params.symbol);
  const style = tradingStyleLabel(params.style);
  const styleArg = params.style.toLowerCase();

  return joinTelegramSections(
    '📐 <b>Benchmark — pick a run</b>',
    joinTelegramLines(
      '<i>Replay engine signals with trailing TP (1:1.5 → 1:4). Takes ~30–90s.</i>',
      '',
      `<b>Defaults if you omit symbol/style:</b> ${sym} · ${style}`,
      `<b>Uses now:</b> veto <b>${vetoModeLabel(params.vetoMode)}</b> · flow <b>${flowModeLabel(params.flowMode)}</b>`,
      '<i>Change with</i> <code>/veto</code> <i>and</i> <code>/flow</code> <i>before you run.</i>',
    ),
    joinTelegramLines(
      '<b>Quick picks</b> (tap to copy)',
      `<code>/benchmark 14</code> — 14-day replay · AI shadow`,
      `<code>/benchmark 30 2</code> — 30 days · max <b>2 trades/day</b> (recommended)`,
      `<code>/benchmark 30 ai-shadow</code> — longer window · AI opinions logged`,
      `<code>/benchmark ai-off</code> — engine only · no AI API calls`,
    ),
    joinTelegramLines(
      '<b>Symbol &amp; style</b>',
      `<code>/benchmark ${sym} ${styleArg} 30</code> — your watchlist index + style`,
      `<code>/benchmark BANKNIFTY INTRADAY 14</code> — explicit index`,
      `<code>/benchmark max2</code> — cap entries (also <code>2</code> after days)`,
    ),
    joinTelegramLines(
      '<b>AI compare</b>',
      '<code>/benchmark 30 ai-active</code> — re-gate entries on AI-adjusted conviction',
      '<code>/benchmark 30 ai-shadow</code> — same entries · record agree/disagree',
      '<code>/benchmark ai-off</code> — skip AI entirely',
    ),
    joinTelegramLines(
      '<i>Days: 3–60 · Daily cap: 1–20 or unlimited · Visual report button after each run.</i>',
    ),
  );
}

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