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
import {
  buildCoachSessionTakeaway,
  translateCoachCoachingLine,
  uiCoachClosedLegsOnly,
  uiCoachClosedLegsSummary,
  uiCoachEntryWindow,
  uiCoachFillsLoggedNothingClosed,
  uiCoachFillsNothingClosed,
  uiCoachFyersAccountNet,
  uiCoachMoreTrades,
  uiCoachNoClosedAcrossStyles,
  uiCoachNoClosedToday,
  uiCoachNoFillsToday,
  uiCoachNoSignalsToday,
  uiCoachOffScript,
  uiCoachOpenNoClosedYet,
  uiCoachPnlLabel,
  uiCoachPositionsStillOpen,
  uiCoachSignalsTitle,
  uiCoachStillOpenTitle,
  uiCoachStylePnlLine,
  uiCoachTradesTitle,
  uiCoachTrimmed,
  uiCoachAvgPremium,
} from './voice-coach-copy';
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

function formatGroupedTradeLines(
  reports: TradingCoachTradeReport[],
  voice: TelegramVoice,
): string {
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
      const lines = bucketReports.map((report) => formatTradeLine(report, voice));

      if (bucketReports.length === 1) {
        return lines[0];
      }

      const label = formatEntryMinuteLabel(bucketReports[0].trade.entryAtMs);
      return joinTelegramLines(uiCoachEntryWindow(label, voice), ...lines);
    })
    .join('\n\n');
}

function formatTradeLine(
  report: TradingCoachTradeReport,
  voice: TelegramVoice,
): string {
  const { trade, analysis } = report;
  const pnl = trade.pnlInr;
  const time = formatTradeTimeRange(trade);
  const coachingRaw = analysis.coaching[0] ?? '';
  const coaching = coachingRaw
    ? translateCoachCoachingLine(coachingRaw, voice)
    : '';
  const optionLabel = trade.optionSymbol.split(':').pop() ?? trade.optionSymbol;
  const approved = analysis.systemApproved ? '✅' : uiCoachOffScript(voice);
  const qtyLabel = ` · ${trade.qty} qty`;

  return [
    `${verdictPrefix(analysis.verdict)} <b>${escapeHtml(optionLabel)}</b> · ${time}${qtyLabel} · ${pnlIcon(pnl)} ${formatSignedInr(pnl)} · ${approved}`,
    coaching ? `   💡 ${escapeHtml(coaching)}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

function formatOpenPositionLine(
  pos: CoachOpenPosition,
  voice: TelegramVoice,
): string {
  const optionLabel = pos.optionSymbol.split(':').pop() ?? pos.optionSymbol;
  const time = formatIstClockFromMs(pos.entryAtMs);
  const qtyLabel = `${pos.qty} qty`;
  const avgLabel = uiCoachAvgPremium(voice);
  return `📂 <b>${escapeHtml(optionLabel)}</b> · ${time} · ${qtyLabel} · ${avgLabel} ₹${pos.avgEntryPremium.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function formatSignalRecap(
  snapshots: SignalSnapshot[],
  voice: TelegramVoice,
): string {
  if (!snapshots.length) return uiCoachNoSignalsToday(voice);

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
  voice: TelegramVoice,
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
  const pnlLabel = uiCoachPnlLabel(voice);

  if (totalTrades === 0) {
    if (totalOpen > 0) {
      const lines = [
        `${pnlIcon(totalPnl)} 💰 <b>${pnlLabel}</b> ${formatSignedInr(totalPnl, 2)}`,
        uiCoachOpenNoClosedYet(totalOpen, voice),
      ];
      if (brokerNet != null && Math.abs(brokerNet - totalPnl) >= 1) {
        lines.push(
          `   📎 ${uiCoachFyersAccountNet(voice)} ${formatSignedInr(brokerNet, 2)}`,
        );
      }
      return lines.join('\n');
    }
    return anyFills
      ? uiCoachFillsLoggedNothingClosed(voice)
      : emptyClosedLabel;
  }

  const lines = [
    `${pnlIcon(totalPnl)} 💰 <b>${pnlLabel}</b> ${formatSignedInr(totalPnl, 2)}`,
    uiCoachClosedLegsSummary(totalTrades, totalOpen, voice),
  ];

  if (totalOpen > 0 && Math.abs(closedPnl - totalPnl) >= 1) {
    lines.push(
      `   📎 ${uiCoachClosedLegsOnly(voice)} ${formatSignedInr(closedPnl, 2)}`,
    );
  } else if (brokerNet != null && Math.abs(brokerNet - totalPnl) >= 1) {
    lines.push(
      `   📎 ${uiCoachFyersAccountNet(voice)} ${formatSignedInr(brokerNet, 2)}`,
    );
  }

  return lines.join('\n');
}

function formatStyleSection(
  coach: TradingCoachResponse,
  snapshots: SignalSnapshot[],
  voice: TelegramVoice,
): string {
  const style = coach.tradingStyle;
  const { summary } = coach;
  const styleSnapshots = snapshots.filter((s) => s.tradingStyle === style);
  const openLines = coach.openPositions
    .map((pos) => formatOpenPositionLine(pos, voice))
    .join('\n');

  if (summary.totalRoundTrips === 0) {
    const emptyTradeHint =
      coach.openPositions.length > 0
        ? joinTelegramLines(
            uiCoachPositionsStillOpen(coach.openPositions.length, voice),
            openLines,
          )
        : coach.rawFillCount > 0
          ? uiCoachFillsNothingClosed(coach.rawFillCount, voice)
          : uiCoachNoFillsToday(voice);
    return joinTelegramSections(
      joinTelegramLines(
        formatSectionHeader('coach', String(style), '📊'),
        emptyTradeHint,
      ),
      joinTelegramLines(
        formatSectionHeader('info', uiCoachSignalsTitle(voice), '📡'),
        formatSignalRecap(styleSnapshots, voice),
      ),
    );
  }

  const closedPnl = summary.computedRoundTripPnlInr;
  const pnlText = formatSignedInr(closedPnl, 2);
  const closedLegsOnly =
    summary.openPositionCount > 0 &&
    Math.abs(closedPnl - summary.totalPnlInr) >= 1;
  const stylePnlLine = uiCoachStylePnlLine({
    voice,
    pnlText,
    winCount: summary.winCount,
    lossCount: summary.lossCount,
    good: summary.verdicts.good,
    bad: summary.verdicts.bad,
    ugly: summary.verdicts.ugly,
    closedLegsOnly,
  });
  const visibleTrades = coach.trades.slice(0, 5);
  const tradeLines = formatGroupedTradeLines(visibleTrades, voice);

  const more =
    coach.trades.length > 5
      ? `\n\n${uiCoachMoreTrades(coach.trades.length - 5, voice)}`
      : '';

  const ugly = coach.trades.filter((t) => t.analysis.verdict === 'ugly');
  const discretionaryWins = coach.trades.filter((t) =>
    t.analysis.tags.includes('lucky_override'),
  );
  const earlyExits = coach.trades.filter((t) =>
    t.analysis.tags.includes('early_exit'),
  );
  const takeaway = buildCoachSessionTakeaway(
    {
      summary,
      uglyCount: ugly.length,
      luckyWinCount: discretionaryWins.length,
      earlyExitCount: earlyExits.length,
    },
    voice,
  );
  const openSection =
    openLines.length > 0
      ? joinTelegramLines(
          formatSectionHeader('coach', uiCoachStillOpenTitle(voice), '📂'),
          openLines,
        )
      : null;

  return joinTelegramSections(
    joinTelegramLines(
      formatSectionHeader('coach', String(style), '📊'),
      stylePnlLine,
    ),
    joinTelegramLines(
      formatSectionHeader('coach', uiCoachTradesTitle(voice), '🎬'),
      tradeLines + more,
    ),
    openSection,
    `💬 ${escapeHtml(takeaway)}`,
    joinTelegramLines(
      formatSectionHeader('info', uiCoachSignalsTitle(voice), '📡'),
      formatSignalRecap(styleSnapshots, voice),
    ),
  );
}

export function formatTelegramCoachOnDemandMessage(params: {
  sessionDate: string;
  coaches: TradingCoachResponse[];
  snapshots: SignalSnapshot[];
  voice?: TelegramVoice;
}): string {
  const voice = params.voice ?? DEFAULT_TELEGRAM_VOICE;
  const { sessionDate, coaches, snapshots } = params;
  const dateLabel = formatIstDateLabel(sessionDate);

  const sections = coaches.map((coach) =>
    formatStyleSection(coach, snapshots, voice),
  );

  const headerPnl = buildCoachHeaderPnl(
    coaches,
    uiCoachNoClosedToday(voice),
    voice,
  );

  const body = joinTelegramSections(
    joinTelegramLines(
      formatScenarioBanner('coach', uiCoachBanner(true, voice)),
      `📅 ${dateLabel}`,
      headerPnl,
    ),
    ...sections,
  );

  if (body.length <= 3900) return body;
  return `${body.slice(0, 3850)}\n\n${uiCoachTrimmed(voice)}`;
}

export function formatTelegramCoachSummaryMessage(params: {
  sessionDate: string;
  coaches: TradingCoachResponse[];
  snapshots: SignalSnapshot[];
  voice?: TelegramVoice;
}): string {
  const voice = params.voice ?? DEFAULT_TELEGRAM_VOICE;
  const { sessionDate, coaches, snapshots } = params;
  const dateLabel = formatIstDateLabel(sessionDate);

  const sections = coaches.map((coach) =>
    formatStyleSection(coach, snapshots, voice),
  );

  const headerPnl = buildCoachHeaderPnl(
    coaches,
    uiCoachNoClosedAcrossStyles(voice),
    voice,
  );

  const body = joinTelegramSections(
    joinTelegramLines(
      formatScenarioBanner('coach', uiCoachBanner(false, voice)),
      `📅 ${dateLabel}`,
      headerPnl,
    ),
    ...sections,
  );

  if (body.length <= 3900) return body;
  return `${body.slice(0, 3850)}\n\n${uiCoachTrimmed(voice)}`;
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
  voice?: TelegramVoice;
}): string {
  const voice = params.voice ?? DEFAULT_TELEGRAM_VOICE;
  const dateLabel = formatIstDateLabel(params.sessionDate);
  return joinTelegramSections(
    joinTelegramLines('🏁 <b>Day’s wrap</b>', `📅 ${dateLabel}`),
    `😬 Trade review hit a wall: ${escapeHtml(params.error)}`,
    joinTelegramLines(
      `📡 <b>${uiCoachSignalsTitle(voice)}</b>`,
      formatSignalRecap(params.snapshots, voice),
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