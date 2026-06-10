import {
  CoachVerdict,
  TradingCoachResponse,
  TradingCoachTradeReport,
} from '../types/trading-coach';
import { SignalSnapshot } from '../types/telegram-notifications';
import { TradingStyle } from '../types/trading-style';
import { TELEGRAM_MSG_RULE } from './message-layout';

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
  const coaching = analysis.coaching[0] ?? 'Worth a replay — did entry and exit match your rules?';
  const optionLabel = trade.optionSymbol.split(':').pop() ?? trade.optionSymbol;

  return [
    `${verdictEmoji(analysis.verdict)} <b>${escapeHtml(optionLabel)}</b> · ${trade.direction} · ${time}`,
    `   ${pnlEmoji(pnl)} PnL: ${sign}₹${Math.abs(pnl).toLocaleString('en-IN', { maximumFractionDigits: 0 })} · ${analysis.entryQuality} entry · ${analysis.exitQuality} exit`,
    analysis.systemApproved ? '   🎯 Engine gave the thumbs-up at entry' : '   🎲 You went off-script at entry',
    `   💡 ${escapeHtml(coaching)}`,
  ].join('\n');
}

function formatSignalRecap(snapshots: SignalSnapshot[]): string {
  if (!snapshots.length) return '📡 No signal snapshots saved today — quiet on the wire.';

  return snapshots
    .map((snap) => {
      const label = shortSymbol(snap.symbol);
      const ready = snap.shouldConsiderTrade ? '✅ green light' : '⏸ below bar';
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
    const emptyTradeHint =
      coach.rawFillCount > 0
        ? `📭 ${coach.rawFillCount} fill(s) logged — nothing closed yet.\nSquare off and I’ll grade the round trip.`
        : coach.source === 'fyers_tradebook'
          ? '📭 Tradebook’s empty so far — the market owes you nothing yet.'
          : '📭 No fills on this date.';
    return [
      `🎯 <b>${escapeHtml(style)}</b>`,
      emptyTradeHint,
      '',
      '<b>How the day ended (signals)</b>',
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
    `${pnlEmoji(pnl)} <b>PnL:</b> ${pnlSign}₹${Math.abs(pnl).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`,
    `🏁 ${summary.winCount}W / ${summary.lossCount}L · ${summary.systemApprovedCount} approved`,
    `📋 ✅ ${summary.verdicts.good} · ⚠️ ${summary.verdicts.bad} · 🚨 ${summary.verdicts.ugly}`,
    '',
    '<b>Trade-by-trade replay</b>',
    tradeLines + more,
    '',
    '<b>Real talk — what to fix tomorrow</b>',
    escapeHtml(takeaway),
    '',
    '<b>End-of-day signal snapshot</b>',
    formatSignalRecap(styleSnapshots),
  ].join('\n');
}

function buildSessionTakeaway(coach: TradingCoachResponse): string {
  const { summary, trades } = coach;

  if (summary.totalRoundTrips === 0) {
    return 'Flat day — no trades to roast. Use the signal snapshot to plan tomorrow’s watchlist.';
  }

  const ugly = trades.filter((t) => t.analysis.verdict === 'ugly');
  const discretionaryWins = trades.filter(
    (t) => t.analysis.tags.includes('lucky_override'),
  );
  const earlyExits = trades.filter((t) => t.analysis.tags.includes('early_exit'));

  const parts: string[] = [];

  if (summary.verdicts.good > 0 && summary.verdicts.ugly === 0) {
    parts.push('Clean sheet on discipline — rinse and repeat the approved-entry playbook.');
  } else if (summary.verdicts.ugly > 0) {
    parts.push(
      `${summary.verdicts.ugly} ugly trade(s) — plug the leaks before you size up.`,
    );
  }

  if (ugly.length) {
    parts.push(
      'Biggest leak: entries the engine didn’t bless — walk past those tomorrow.',
    );
  }

  if (discretionaryWins.length) {
    parts.push(
      `${discretionaryWins.length} lucky off-script win(s) — don’t let them fool you into loosening rules.`,
    );
  }

  if (earlyExits.length) {
    parts.push(
      `${earlyExits.length} early bail(s) — spot kept paying after you left the party.`,
    );
  }

  if (summary.systemApprovedCount < summary.analyzed) {
    parts.push(
      `${summary.analyzed - summary.systemApprovedCount} trade(s) started without engine approval.`,
    );
  }

  return parts.length
    ? parts.join(' ')
    : 'Quick replay: did every entry earn its conviction and every exit earn its keep?';
}

export function formatTelegramCoachOnDemandMessage(params: {
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
  const anyFills = coaches.some((c) => c.rawFillCount > 0);
  const headerPnl =
    totalTrades > 0
      ? [
          `${pnlEmoji(totalPnl)} <b>PnL:</b> ${pnlSign}₹${Math.abs(totalPnl).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`,
          `${totalTrades} round trip(s)`,
        ].join('\n')
      : anyFills
        ? '📭 Fills on the book — nothing squared off yet.\nClose a round trip and I’ll grade it.'
        : '📭 No closed trades today — sometimes the best trade is no trade.';

  const body = [
    '📚 <b>Coach mode</b>',
    `📅 ${dateLabel} · straight from your tradebook`,
    TELEGRAM_MSG_RULE,
    headerPnl,
    TELEGRAM_MSG_RULE,
    ...sections,
    TELEGRAM_MSG_RULE,
    '🧠 Replay uses index price only — option flow wasn’t in the room.',
  ].join('\n\n');

  if (body.length <= 3900) return body;
  return `${body.slice(0, 3850)}\n\n… trimmed — Telegram has a size limit`;
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
      ? [
          `${pnlEmoji(totalPnl)} <b>PnL:</b> ${pnlSign}₹${Math.abs(totalPnl).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`,
          `${totalTrades} round trip(s)`,
        ].join('\n')
      : '📭 No closed trades across your watched styles.';

  const body = [
    '🏁 <b>Day’s wrap</b>',
    `📅 ${dateLabel} · bell rang at NSE close`,
    TELEGRAM_MSG_RULE,
    headerPnl,
    TELEGRAM_MSG_RULE,
    ...sections,
    TELEGRAM_MSG_RULE,
    '🧠 Replay uses index price only — option flow wasn’t in the room.',
  ].join('\n\n');

  if (body.length <= 3900) return body;
  return `${body.slice(0, 3850)}\n\n… trimmed — Telegram has a size limit`;
}

export { FYERS_AUTH_ERROR_REPLY } from './fyers-login-reminder';

export function isFyersAuthError(error: string): boolean {
  const lower = error.toLowerCase();
  return (
    lower.includes('token') &&
    (lower.includes('missing') ||
      lower.includes('expired') ||
      lower.includes('invalid') ||
      lower.includes('login') ||
      lower.includes('authenticate'))
  );
}

export function formatTelegramCoachOnDemandErrorMessage(params: {
  sessionDate: string;
  error: string;
}): string {
  const dateLabel = formatIstDateLabel(params.sessionDate);
  return [
    '📚 <b>Coach mode</b>',
    `📅 ${dateLabel}`,
    TELEGRAM_MSG_RULE,
    `😬 Couldn’t pull your tradebook: ${escapeHtml(params.error)}`,
  ].join('\n');
}

export function formatTelegramCoachErrorMessage(params: {
  sessionDate: string;
  error: string;
  snapshots: SignalSnapshot[];
}): string {
  const dateLabel = formatIstDateLabel(params.sessionDate);
  return [
    '🏁 <b>Day’s wrap</b>',
    `📅 ${dateLabel}`,
    TELEGRAM_MSG_RULE,
    `😬 Trade review hit a wall: ${escapeHtml(params.error)}`,
    '',
    '<b>End-of-day signal snapshot</b>',
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