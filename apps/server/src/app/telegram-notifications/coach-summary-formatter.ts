import { resolveCoachBrokerNetPnlInr } from '../trading-coach/fyers-trades';
import {
  CoachOpenPosition,
  CoachVerdict,
  TradingCoachResponse,
  TradingCoachTradeReport,
} from '../types/trading-coach';
import { SignalSnapshot } from '../types/telegram-notifications';
import { TradingStyle } from '../types/trading-style';
import { DEFAULT_TELEGRAM_VOICE, TelegramVoice } from '../types/telegram-voice';
import { uiCoachBanner } from './voice-ui-copy';
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

function formatIstClockFromMs(epochMs: number): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(epochMs));
}

function formatTradeTimeRange(trade: TradingCoachTradeReport['trade']): string {
  const entry = formatIstClockFromMs(trade.entryAtMs);
  const exit = formatIstClockFromMs(trade.exitAtMs);
  if (entry === exit) return entry;
  return `${entry}→${exit}`;
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

function formatSignedInr(pnl: number, maxFractionDigits = 0): string {
  if (pnl === 0) return '₹0';
  const sign = pnl > 0 ? '+' : '-';
  return `${sign}₹${Math.abs(pnl).toLocaleString('en-IN', {
    maximumFractionDigits: maxFractionDigits,
  })}`;
}

function verdictPrefix(verdict: CoachVerdict): string {
  return paletteToken(scenarioForCoachVerdict(verdict)).accent;
}

function formatEntryMinuteLabel(entryAtMs: number): string {
  return formatIstClockFromMs(entryAtMs);
}

function formatGroupedTradeLines(reports: TradingCoachTradeReport[]): string {
  const groups = new Map<number, TradingCoachTradeReport[]>();

  for (const report of reports) {
    const bucket = Math.floor(report.trade.entryAtMs / 60_000);
    const bucketReports = groups.get(bucket) ?? [];
    bucketReports.push(report);
    groups.set(bucket, bucketReports);
  }

  const sortedBuckets = [...groups.keys()].sort((a, b) => b - a);

  return sortedBuckets
    .map((bucket) => {
      const bucketReports = groups.get(bucket) ?? [];
      const lines = bucketReports.map((report) => formatTradeLine(report));

      if (bucketReports.length === 1) {
        return lines[0];
      }

      const label = formatEntryMinuteLabel(bucketReports[0].trade.entryAtMs);
      return joinTelegramLines(`🕐 <b>${label}</b> entry window`, ...lines);
    })
    .join('\n\n');
}

function formatTradeLine(report: TradingCoachTradeReport): string {
  const { trade, analysis } = report;
  const pnl = trade.pnlInr;
  const time = formatTradeTimeRange(trade);
  const coaching = analysis.coaching[0] ?? '';
  const optionLabel = trade.optionSymbol.split(':').pop() ?? trade.optionSymbol;
  const approved = analysis.systemApproved ? '✅' : '⚠️ off-script';
  const qtyLabel = ` · ${trade.qty} qty`;

  return [
    `${verdictPrefix(analysis.verdict)} <b>${escapeHtml(optionLabel)}</b> · ${time}${qtyLabel} · ${pnlIcon(pnl)} ${formatSignedInr(pnl)} · ${approved}`,
    coaching ? `   💡 ${escapeHtml(coaching)}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

function formatOpenPositionLine(pos: CoachOpenPosition): string {
  const optionLabel = pos.optionSymbol.split(':').pop() ?? pos.optionSymbol;
  const time = formatIstClockFromMs(pos.entryAtMs);
  const qtyLabel = `${pos.qty} qty`;
  return `📂 <b>${escapeHtml(optionLabel)}</b> · ${time} · ${qtyLabel} · avg ₹${pos.avgEntryPremium.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
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

function accountCoachSummary(
  coaches: TradingCoachResponse[],
): TradingCoachResponse['summary'] | null {
  return coaches[0]?.summary ?? null;
}

function buildCoachHeaderPnl(
  coaches: TradingCoachResponse[],
  emptyClosedLabel: string,
): string {
  const primary = coaches[0];
  const summary = accountCoachSummary(coaches);
  if (!primary || !summary) return emptyClosedLabel;

  const totalPnl = summary.totalPnlInr;
  const totalTrades = summary.totalRoundTrips;
  const totalOpen = summary.openPositionCount;
  const closedPnl = summary.computedRoundTripPnlInr;
  const anyFills = coaches.some((c) => c.rawFillCount > 0);
  const brokerNet = resolveCoachBrokerNetPnlInr({
    pnlSummary: primary.pnlSummary,
    symbolPnl: primary.symbolPnl,
    indexFilter: primary.indexFilter,
  });

  if (totalTrades === 0) {
    if (totalOpen > 0) {
      const lines = [
        `${pnlIcon(totalPnl)} 💰 <b>PnL:</b> ${formatSignedInr(totalPnl, 2)}`,
        `📂 ${totalOpen} position(s) still open — no closed legs yet`,
      ];
      if (brokerNet != null && Math.abs(brokerNet - totalPnl) >= 1) {
        lines.push(
          `   📎 Fyers account net: ${formatSignedInr(brokerNet, 2)}`,
        );
      }
      return lines.join('\n');
    }
    return anyFills ? '📭 Fills logged — nothing closed yet' : emptyClosedLabel;
  }

  const lines = [
    `${pnlIcon(totalPnl)} 💰 <b>PnL:</b> ${formatSignedInr(totalPnl, 2)}`,
    `🏁 ${totalTrades} closed leg(s)${totalOpen > 0 ? ` · 📂 ${totalOpen} open` : ''}`,
  ];

  if (totalOpen > 0 && Math.abs(closedPnl - totalPnl) >= 1) {
    lines.push(`   📎 Closed legs only: ${formatSignedInr(closedPnl, 2)}`);
  } else if (brokerNet != null && Math.abs(brokerNet - totalPnl) >= 1) {
    lines.push(`   📎 Fyers account net: ${formatSignedInr(brokerNet, 2)}`);
  }

  return lines.join('\n');
}

function formatStyleSection(
  coach: TradingCoachResponse,
  snapshots: SignalSnapshot[],
): string {
  const style = coach.tradingStyle;
  const { summary } = coach;
  const styleSnapshots = snapshots.filter((s) => s.tradingStyle === style);
  const openLines = coach.openPositions
    .map((pos) => formatOpenPositionLine(pos))
    .join('\n');

  if (summary.totalRoundTrips === 0) {
    const emptyTradeHint =
      coach.openPositions.length > 0
        ? joinTelegramLines(
            `📂 ${coach.openPositions.length} position(s) still open`,
            openLines,
          )
        : coach.rawFillCount > 0
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

  const closedPnl = summary.computedRoundTripPnlInr;
  const pnlText = formatSignedInr(closedPnl, 2);
  const stylePnlLine =
    summary.openPositionCount > 0 &&
    Math.abs(closedPnl - summary.totalPnlInr) >= 1
      ? `💰 Closed legs ${pnlText} · 🏁 ${summary.winCount}W/${summary.lossCount}L · ✅${summary.verdicts.good} ⚠️${summary.verdicts.bad} 🚨${summary.verdicts.ugly}`
      : `💰 ${pnlText} · 🏁 ${summary.winCount}W/${summary.lossCount}L · ✅${summary.verdicts.good} ⚠️${summary.verdicts.bad} 🚨${summary.verdicts.ugly}`;
  const visibleTrades = coach.trades.slice(0, 5);
  const tradeLines = formatGroupedTradeLines(visibleTrades);

  const more =
    coach.trades.length > 5
      ? `\n\n… +${coach.trades.length - 5} more trade(s) — full detail in /api/trading-coach`
      : '';

  const takeaway = buildSessionTakeaway(coach);
  const openSection =
    openLines.length > 0
      ? joinTelegramLines(
          formatSectionHeader('coach', 'Still open', '📂'),
          openLines,
        )
      : null;

  return joinTelegramSections(
    joinTelegramLines(
      formatSectionHeader('coach', String(style), '📊'),
      stylePnlLine,
    ),
    joinTelegramLines(
      formatSectionHeader('coach', 'Trades', '🎬'),
      tradeLines + more,
    ),
    openSection,
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
  voice?: TelegramVoice;
}): string {
  const { sessionDate, coaches, snapshots } = params;
  const dateLabel = formatIstDateLabel(sessionDate);

  const sections = coaches.map((coach) => formatStyleSection(coach, snapshots));

  const headerPnl = buildCoachHeaderPnl(coaches, '📭 No closed trades today');

  const voice = params.voice ?? DEFAULT_TELEGRAM_VOICE;
  const body = joinTelegramSections(
    joinTelegramLines(
      formatScenarioBanner('coach', uiCoachBanner(true, voice)),
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
  voice?: TelegramVoice;
}): string {
  const { sessionDate, coaches, snapshots } = params;
  const dateLabel = formatIstDateLabel(sessionDate);

  const sections = coaches.map((coach) => formatStyleSection(coach, snapshots));

  const headerPnl = buildCoachHeaderPnl(
    coaches,
    '📭 No closed trades across your watched styles.',
  );

  const voice = params.voice ?? DEFAULT_TELEGRAM_VOICE;
  const body = joinTelegramSections(
    joinTelegramLines(
      formatScenarioBanner('coach', uiCoachBanner(false, voice)),
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