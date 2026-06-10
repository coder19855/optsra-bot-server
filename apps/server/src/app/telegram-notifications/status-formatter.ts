import { TelegramNotificationStatus } from '../types/telegram-notifications';
import { formatSectionHeader } from './telegram-palette';

function formatIstTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

export function formatTelegramStatusMessage(
  status: TelegramNotificationStatus,
): string {
  const alertState = status.alertsPaused
    ? '⏸ <b>Paused</b> — no signal or pre-session pings'
    : '▶️ <b>Active</b> — watching for signal flips';

  const fyersState = status.isTokenValid
    ? '✅ Fyers session live'
    : '⚠️ Fyers token missing or expired — <code>/login</code>';

  const marketState = status.marketOpen
    ? '🟢 Market open'
    : status.preSessionLearningWindow
      ? '🌅 Pre-session window'
      : status.postSessionCoachWindow
        ? '📚 Post-session coach window'
        : '🌙 Outside session hours';

  const pollState = status.lastPollAt
    ? `Last poll ${formatIstTime(status.lastPollAt)}`
    : 'No poll yet this boot';

  const tpLine =
    status.openPositionsTracked > 0
      ? `🎯 TP tracking ${status.openPositionsTracked} position(s) (${status.openPositionsMonitored} monitored)`
      : status.openPositionsMonitored > 0
        ? `👀 ${status.openPositionsMonitored} open position(s) — none on TP track yet`
        : '📭 No open positions on watch';

  const watchLabels = status.watched
    .map((w) => {
      const short =
        w.symbol.split(':')[1]?.replace('-INDEX', '') ?? w.symbol;
      return `${short} · ${w.tradingStyle}`;
    })
    .join('\n');

  const lines = [
    formatSectionHeader('info', 'Bot status', '📡'),
    alertState,
    fyersState,
    marketState,
    '',
    pollState,
    status.lastPollError ? `⚠️ ${status.lastPollError}` : null,
    tpLine,
    status.alertsPaused && status.alertsPausedAt
      ? `\nPaused since ${formatIstTime(status.alertsPausedAt)} — <code>/start</code> or <code>/login</code> to resume`
      : null,
    status.alertsPaused
      ? '\n<i>TP/hold nudges and commands still work while paused.</i>'
      : null,
    watchLabels ? `\n<b>On watch</b>\n${watchLabels}` : null,
  ].filter(Boolean);

  return lines.join('\n');
}