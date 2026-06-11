import {
  CoachVerdict,
  TradingCoachResponse,
  TradingCoachTradeReport,
} from '../types/trading-coach';
import { SignalSnapshot } from '../types/telegram-notifications';
import { TradingStyle } from '../types/trading-style';
import { joinTelegramLines, joinTelegramSections } from './message-layout';
import {
  formatScenarioBanner,
  formatSectionHeader,
  paletteToken,
  scenarioForAction,
  scenarioForCoachVerdict,
  scenarioForPnl,
} from './telegram-palette';

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

function pnlIcon(pnl: number): string {
  return paletteToken(scenarioForPnl(pnl)).accent;
}

function verdictPrefix(verdict: CoachVerdict): string {
  return paletteToken(scenarioForCoachVerdict(verdict)).accent;
}

function formatTradeLine(report: TradingCoachTradeReport): string {
  const { trade, analysis } = report;
  const pnl = trade.pnlInr;
  const sign = pnl >= 0 ? '+' : '';
  const time = trade.entryAtISO.slice(11, 16);
  const coaching = analysis.coaching[0] ?? '';
  const optionLabel = trade.optionSymbol.split(':').pop() ?? trade.optionSymbol;
  const approved = analysis.systemApproved ? '✅' : '⚠️ off-script';

  return [
    `${verdictPrefix(analysis.verdict)} <b>${escapeHtml(optionLabel)}</b> · ${time} · ${pnlIcon(pnl)} ${sign}₹${Math.abs(pnl).toLocaleString('en-IN', { maximumFractionDigits: 0 })} · ${approved}`,
    coaching ? `   💡 ${escapeHtml(coaching)}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

function formatSignalRecap(snapshots: SignalSnapshot[]): string {
  if (!snapshots.length) return '📡 No signals logged today.';

  return snapshots
    .map((snap) => {
      const label = shortSymbol(snap.symbol);
      const ready = snap.shouldConsiderTrade ? '✅' : '⚠️';
      return `${paletteToken(scenarioForAction(snap.action)).accent} ${escapeHtml(label)} ${snap.action} ${snap.conviction}% ${ready}`;
    })
    .join('\n');
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
        ? `📭 ${coach.rawFillCount} fill(s) — nothing closed yet`
        : '📭 No fills today';
    return joinTelegramSections(
      joinTelegramLines(
        formatSectionHeader('coach', String(style), '📊'),
        emptyTradeHint,
      ),
      joinTelegramLines(
        formatSectionHeader('info', 'Signals', '📡'),
        formatSignalRecap(styleSnapshots),
      ),
    );
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

  return joinTelegramSections(
    joinTelegramLines(
      formatSectionHeader('coach', String(style), '📊'),
      `💰 ${pnlSign}₹${Math.abs(pnl).toLocaleString('en-IN', { maximumFractionDigits: 0 })} · 🏁 ${summary.winCount}W/${summary.lossCount}L · ✅${summary.verdicts.good} ⚠️${summary.verdicts.bad} 🚨${summary.verdicts.ugly}`,
    ),
    joinTelegramLines(
      formatSectionHeader('coach', 'Trades', '🎬'),
      tradeLines + more,
    ),
    `💬 ${escapeHtml(takeaway)}`,
    joinTelegramLines(
      formatSectionHeader('info', 'Signals', '📡'),
      formatSignalRecap(styleSnapshots),
    ),
  );
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
          `${pnlIcon(totalPnl)} 💰 <b>PnL:</b> ${pnlSign}₹${Math.abs(totalPnl).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`,
          `🏁 ${totalTrades} round trip(s)`,
        ].join('\n')
      : anyFills
        ? '📭 Fills logged — nothing closed yet'
        : '📭 No closed trades today';

  const body = joinTelegramSections(
    joinTelegramLines(
      formatScenarioBanner('coach', 'Coach'),
      `📅 ${dateLabel}`,
      headerPnl,
    ),
    ...sections,
  );

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
          `${pnlIcon(totalPnl)} 💰 <b>PnL:</b> ${pnlSign}₹${Math.abs(totalPnl).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`,
          `🏁 ${totalTrades} round trip(s)`,
        ].join('\n')
      : '📭 No closed trades across your watched styles.';

  const body = joinTelegramSections(
    joinTelegramLines(
      formatScenarioBanner('coach', 'Day wrap'),
      `📅 ${dateLabel}`,
      headerPnl,
    ),
    ...sections,
  );

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
  return joinTelegramSections(
    joinTelegramLines('📚 <b>Coach mode</b>', `📅 ${dateLabel}`),
    `😬 Couldn’t pull your tradebook: ${escapeHtml(params.error)}`,
  );
}

export function formatTelegramCoachErrorMessage(params: {
  sessionDate: string;
  error: string;
  snapshots: SignalSnapshot[];
}): string {
  const dateLabel = formatIstDateLabel(params.sessionDate);
  return joinTelegramSections(
    joinTelegramLines('🏁 <b>Day’s wrap</b>', `📅 ${dateLabel}`),
    `😬 Trade review hit a wall: ${escapeHtml(params.error)}`,
    joinTelegramLines(
      '📡 <b>End-of-day signal snapshot</b>',
      formatSignalRecap(params.snapshots),
    ),
  );
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