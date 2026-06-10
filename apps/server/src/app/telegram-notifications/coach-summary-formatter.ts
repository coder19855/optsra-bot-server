import {
  CoachVerdict,
  TradingCoachResponse,
  TradingCoachTradeReport,
} from '../types/trading-coach';
import { SignalSnapshot } from '../types/telegram-notifications';
import { TradingStyle } from '../types/trading-style';

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

function formatIstDateLabel(sessionDate: string): string {
  const [year, month, day] = sessionDate.split('-');
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const m = months[Number(month) - 1] ?? month;
  return `${Number(day)} ${m} ${year}`;
}

function pnlEmoji(pnl: number): string {
  if (pnl > 0) return '🟢';
  if (pnl < 0) return '🔴';
  return '⚪';
}

function verdictEmoji(verdict: CoachVerdict): string {
  if (verdict === 'good') return '✅';
  if (verdict === 'bad') return '⚠️';
  return '🚨';
}

function formatTradeLine(report: TradingCoachTradeReport): string {
  const { trade, analysis } = report;
  const pnl = trade.pnlInr;
  const sign = pnl >= 0 ? '+' : '';
  const time = trade.entryAtISO.slice(11, 16);
  const coaching = analysis.coaching[0] ?? 'Review entry and exit against system rules.';
  const optionLabel = trade.optionSymbol.split(':').pop() ?? trade.optionSymbol;

  return [
    `${verdictEmoji(analysis.verdict)} <b>${escapeHtml(optionLabel)}</b> · ${trade.direction} · ${time}`,
    `   ${pnlEmoji(pnl)} PnL: ${sign}₹${Math.abs(pnl).toLocaleString('en-IN', { maximumFractionDigits: 0 })} · ${analysis.entryQuality} entry · ${analysis.exitQuality} exit`,
    analysis.systemApproved ? '   🎯 System-approved at entry' : '   ⚡ Discretionary entry',
    `   💡 ${escapeHtml(coaching)}`,
  ].join('\n');
}

function formatSignalRecap(snapshots: SignalSnapshot[]): string {
  if (!snapshots.length) return '📡 No signal snapshots stored for today.';

  return snapshots
    .map((snap) => {
      const label = shortSymbol(snap.symbol);
      const ready = snap.shouldConsiderTrade ? '✅ trade-ready' : '⏸ below threshold';
      return `📊 <b>${escapeHtml(label)} · ${escapeHtml(snap.tradingStyle)}</b>\n   ${snap.action} · ${snap.conviction}% conviction · ${ready}`;
    })
    .join('\n\n');
}

function formatStyleSection(
  coach: TradingCoachResponse,
  snapshots: SignalSnapshot[],
): string {
  const style = coach.tradingStyle;
  const { summary } = coach;
  const styleSnapshots = snapshots.filter((s) => s.tradingStyle === style);

  if (summary.totalRoundTrips === 0) {
    return [
      `🎯 <b>${escapeHtml(style)}</b>`,
      '📭 No completed round trips in tradebook.',
      '',
      '<b>Final signals</b>',
      formatSignalRecap(styleSnapshots),
    ].join('\n');
  }

  const pnl = summary.totalPnlInr;
  const pnlSign = pnl >= 0 ? '+' : '';
  const tradeLines = coach.trades
    .slice(0, 5)
    .map((report) => formatTradeLine(report))
    .join('\n\n');

  const more =
    coach.trades.length > 5
      ? `\n\n… +${coach.trades.length - 5} more trade(s) — full detail in /api/trading-coach`
      : '';

  const takeaway = buildSessionTakeaway(coach);

  return [
    `🎯 <b>${escapeHtml(style)}</b>`,
    `${pnlEmoji(pnl)} <b>Session PnL:</b> ${pnlSign}₹${Math.abs(pnl).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`,
    `🏁 ${summary.winCount}W / ${summary.lossCount}L · ${summary.systemApprovedCount} system-approved`,
    `📋 Verdicts: ✅ ${summary.verdicts.good} · ⚠️ ${summary.verdicts.bad} · 🚨 ${summary.verdicts.ugly}`,
    '',
    '<b>Trade review</b>',
    tradeLines + more,
    '',
    '<b>Coach takeaway</b>',
    escapeHtml(takeaway),
    '',
    '<b>Final signals</b>',
    formatSignalRecap(styleSnapshots),
  ].join('\n');
}

function buildSessionTakeaway(coach: TradingCoachResponse): string {
  const { summary, trades } = coach;

  if (summary.totalRoundTrips === 0) {
    return 'No trades to review today. Use the final signal state to plan tomorrow’s watchlist.';
  }

  const ugly = trades.filter((t) => t.analysis.verdict === 'ugly');
  const discretionaryWins = trades.filter(
    (t) => t.analysis.tags.includes('lucky_override'),
  );
  const earlyExits = trades.filter((t) => t.analysis.tags.includes('early_exit'));

  const parts: string[] = [];

  if (summary.verdicts.good > 0 && summary.verdicts.ugly === 0) {
    parts.push('Process held up — focus on repeating system-approved entries.');
  } else if (summary.verdicts.ugly > 0) {
    parts.push(
      `${summary.verdicts.ugly} ugly trade(s): fix discipline leaks before sizing up.`,
    );
  }

  if (ugly.length) {
    parts.push(
      'Worst leak: entries without system approval — skip these setups tomorrow.',
    );
  }

  if (discretionaryWins.length) {
    parts.push(
      `${discretionaryWins.length} discretionary win(s) — do not loosen filters because of these.`,
    );
  }

  if (earlyExits.length) {
    parts.push(
      `${earlyExits.length} early exit(s) — spot kept moving in your favor after you left.`,
    );
  }

  if (summary.systemApprovedCount < summary.analyzed) {
    parts.push(
      `${summary.analyzed - summary.systemApprovedCount} trade(s) were not system-approved at entry.`,
    );
  }

  return parts.length
    ? parts.join(' ')
    : 'Review each trade against entry conviction and exit timing before the next session.';
}

export function formatTelegramCoachSummaryMessage(params: {
  sessionDate: string;
  coaches: TradingCoachResponse[];
  snapshots: SignalSnapshot[];
}): string {
  const { sessionDate, coaches, snapshots } = params;
  const dateLabel = formatIstDateLabel(sessionDate);

  const sections = coaches.map((coach) => formatStyleSection(coach, snapshots));

  const totalPnl = coaches.reduce((sum, c) => sum + c.summary.totalPnlInr, 0);
  const totalTrades = coaches.reduce((sum, c) => sum + c.summary.totalRoundTrips, 0);
  const pnlSign = totalPnl >= 0 ? '+' : '';
  const headerPnl =
    totalTrades > 0
      ? `${pnlEmoji(totalPnl)} <b>Combined PnL:</b> ${pnlSign}₹${Math.abs(totalPnl).toLocaleString('en-IN', { maximumFractionDigits: 0 })} · ${totalTrades} round trip(s)`
      : '📭 No round trips detected across watched styles.';

  const body = [
    '🏁📚 <b>SESSION END — TRADING COACH</b> 📚🏁',
    `📅 ${dateLabel} · NSE close`,
    '━━━━━━━━━━━━━━━━━━━━',
    headerPnl,
    '━━━━━━━━━━━━━━━━━━━━',
    ...sections,
    '━━━━━━━━━━━━━━━━━━━━',
    '🧠 Replay uses index price action only (no historical option flow).',
  ].join('\n\n');

  if (body.length <= 3900) return body;
  return `${body.slice(0, 3850)}\n\n… message trimmed for Telegram length limit`;
}

export function formatTelegramCoachErrorMessage(params: {
  sessionDate: string;
  error: string;
  snapshots: SignalSnapshot[];
}): string {
  const dateLabel = formatIstDateLabel(params.sessionDate);
  return [
    '🏁📚 <b>SESSION END — TRADING COACH</b> 📚🏁',
    `📅 ${dateLabel}`,
    '━━━━━━━━━━━━━━━━━━━━',
    `⚠️ Could not analyze today’s trades: ${escapeHtml(params.error)}`,
    '',
    '<b>Final signals</b>',
    formatSignalRecap(params.snapshots),
  ].join('\n');
}

export function watchedStylesForCoach(styles: TradingStyle[]): TradingStyle[] {
  const seen = new Set<TradingStyle>();
  const ordered: TradingStyle[] = [];
  for (const style of styles) {
    if (seen.has(style)) continue;
    seen.add(style);
    ordered.push(style);
  }
  return ordered;
}