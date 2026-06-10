import { FyersTrackedMethod } from '../constants/fyers-usage';
import {
  FyersPollUsageSnapshot,
  FyersUsageHealth,
  FyersUsageResponse,
} from '../types/fyers-usage';
import { scenarioRule } from './message-layout';
import {
  formatScenarioBanner,
  formatSectionHeader,
  scenarioForFyersHealth,
  tintLine,
  wrapScenarioCallout,
} from './telegram-palette';

const METHOD_SHORT: Partial<Record<FyersTrackedMethod, string>> = {
  getHistory: 'history',
  getOptionChain: 'optChain',
  get_funds: 'funds',
  get_positions: 'positions',
  get_tradebook: 'tradebook',
  get_trade_history: 'trades',
  get_realised_profit_history: 'realPnl',
  get_profile: 'profile',
  getBalance: 'balance',
  getQuotes: 'quotes',
  getMarketDepth: 'depth',
  generate_access_token: 'auth',
  logout_user: 'logout',
  placeOrder: 'order',
  getOrders: 'orders',
  getTransactions: 'txns',
};

function escapePre(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

function formatInr(n: number): string {
  return n.toLocaleString('en-IN');
}

function healthCallout(health: FyersUsageHealth): string {
  const scenario = scenarioForFyersHealth(health);
  const text =
    health === 'critical'
      ? 'Hot — you’re brushing the Fyers rate ceiling'
      : health === 'warning'
        ? 'Warm — pace yourself, limits are getting close'
        : 'Cool — plenty of headroom';
  const healthIcon =
    health === 'critical' ? '🔥' : health === 'warning' ? '🌡' : '❄️';
  return wrapScenarioCallout(scenario, `<b>${healthIcon} API health</b>`, [text]);
}

function padEnd(text: string, width: number): string {
  return text.length >= width ? text.slice(0, width) : text + ' '.repeat(width - text.length);
}

function buildTable(rows: string[][]): string {
  if (!rows.length) return '';
  const widths = rows[0].map((_, col) =>
    Math.max(...rows.map((row) => (row[col] ?? '').length)),
  );
  return rows
    .map((row) => row.map((cell, i) => padEnd(cell ?? '', widths[i])).join(' '))
    .join('\n');
}

function formatLimitsTable(stats: FyersUsageResponse): string {
  const { limits, rolling, totals, headroom } = stats;
  const rows = [
    ['Window', 'Limit', 'Used', 'Left', '%'],
    [
      'Last 60s',
      String(limits.perMinute),
      String(rolling.last60Seconds),
      String(headroom.perMinuteRemaining),
      `${headroom.perMinuteUtilizationPercent}%`,
    ],
    [
      'Today',
      formatInr(limits.perDay),
      formatInr(totals.sessionToday),
      formatInr(headroom.perDayRemaining),
      `${headroom.perDayUtilizationPercent}%`,
    ],
    [
      'Burst/sec',
      String(limits.perSecond),
      '—',
      '—',
      '—',
    ],
    [
      'Since boot',
      '—',
      formatInr(totals.sinceServerStart),
      '—',
      '—',
    ],
  ];
  return buildTable(rows);
}

function formatMethodTable(
  counts: Partial<Record<FyersTrackedMethod, number>>,
  title: string,
  maxRows = 10,
): string | null {
  const entries = Object.entries(counts)
    .filter(([, n]) => (n ?? 0) > 0)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0)) as [FyersTrackedMethod, number][];

  if (!entries.length) return null;

  const shown = entries.slice(0, maxRows);
  const rows = [
    ['Endpoint', 'Hits'],
    ...shown.map(([method, count]) => [
      METHOD_SHORT[method] ?? method,
      String(count),
    ]),
  ];

  let table = buildTable(rows);
  if (entries.length > maxRows) {
    table += `\n… +${entries.length - maxRows} more endpoint(s)`;
  }
  return `${formatSectionHeader('api', title)}\n<pre>${escapePre(table)}</pre>`;
}

function formatPollTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function formatRecentPollsTable(polls: FyersPollUsageSnapshot[]): string | null {
  if (!polls.length) return null;

  const rows = [
    ['Time', 'Scope', 'Calls', 'ms'],
    ...polls.slice(0, 6).map((poll) => [
      formatPollTime(poll.at),
      poll.scope.replace('telegram-', 'tg-'),
      String(poll.total),
      poll.durationMs != null ? String(poll.durationMs) : '—',
    ]),
  ];

  return `${formatSectionHeader('api', 'Recent poll bursts', '📡')}\n<pre>${escapePre(buildTable(rows))}</pre>`;
}

function formatLastPollDetail(poll: FyersPollUsageSnapshot | null): string | null {
  if (!poll || poll.total === 0) return null;

  const topMethods = Object.entries(poll.byMethod)
    .filter(([, n]) => (n ?? 0) > 0)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .slice(0, 4)
    .map(([method, count]) => {
      const short = METHOD_SHORT[method as FyersTrackedMethod] ?? method;
      return `${short}×${count}`;
    })
    .join(' · ');

  const duration =
    poll.durationMs != null ? `${poll.durationMs}ms` : '—';
  return wrapScenarioCallout('api', '<b>⚡ Last poll burst</b>', [
    tintLine('api', `${poll.total} calls in ${duration}`),
    topMethods ? tintLine('api', topMethods) : null,
  ].filter((line): line is string => line != null));
}

export function formatFyersUsageTelegramMessage(
  stats: FyersUsageResponse,
): string {
  const sections = [
    formatScenarioBanner('api', 'Fyers API meter'),
    tintLine('info', `📅 IST session ${stats.istSessionDate}`),
    scenarioRule('api'),
    healthCallout(stats.health),
    '',
    formatSectionHeader('api', 'Limits vs usage', '📊'),
    `<pre>${escapePre(formatLimitsTable(stats))}</pre>`,
  ];

  const sessionMethods = formatMethodTable(
    stats.totals.byMethodSession,
    '📋 Today by endpoint',
  );
  if (sessionMethods) sections.push('', sessionMethods);

  const last60Methods = formatMethodTable(
    stats.rolling.last60SecondsByMethod,
    '⏱ Last 60s by endpoint',
    8,
  );
  if (last60Methods) sections.push('', last60Methods);

  const lastPoll = formatLastPollDetail(stats.lastTelegramPoll);
  if (lastPoll) sections.push('', lastPoll);

  if (stats.rolling.estimatedPerMinuteFromLastPoll != null) {
    sections.push(
      tintLine(
        'warning',
        `If every poll matched the last one: ~${stats.rolling.estimatedPerMinuteFromLastPoll} calls/min`,
      ),
    );
  }

  const recentPolls = formatRecentPollsTable(stats.recentTelegramPolls);
  if (recentPolls) sections.push('', recentPolls);

  sections.push(
    '',
    scenarioRule('muted'),
    tintLine('muted', 'REST calls only — local token checks don’t count.'),
    tintLine('info', 'Full JSON: /api/notifications/fyers-usage'),
  );

  const body = sections.join('\n');
  if (body.length <= 3900) return body;
  return `${body.slice(0, 3850)}\n\n… trimmed for Telegram`;
}