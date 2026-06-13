import { TelegramNotificationStatus } from '../types/telegram-notifications';
import { DEFAULT_TELEGRAM_VOICE, TelegramVoice } from '../types/telegram-voice';
import { joinTelegramLines, joinTelegramSections } from './message-layout';
import { formatSectionHeader } from './telegram-palette';
import {
  uiNowFyersLine,
  uiNowMarketLine,
  uiStatusAlertState,
  uiStatusFyersTokenMissing,
  uiStatusPausedNote,
  uiStatusPausedSince,
  uiStatusPollLine,
  uiStatusTitle,
  uiStatusTpLine,
  uiStatusVoiceLine,
  uiStatusWatchTitle,
} from './voice-ui-copy';

export function formatTelegramStatusMessage(
  status: TelegramNotificationStatus,
  voice: TelegramVoice = DEFAULT_TELEGRAM_VOICE,
): string {
  const alertState = uiStatusAlertState(status.alertsPaused, voice);

  const fyersState = status.isTokenValid
    ? uiNowFyersLine(true, voice)
    : uiStatusFyersTokenMissing(voice);

  const marketState = uiNowMarketLine(
    {
      marketOpen: status.marketOpen,
      preSessionWindow: status.preSessionLearningWindow,
      postSessionCoachWindow: status.postSessionCoachWindow,
      isTokenValid: status.isTokenValid,
      alertsPaused: status.alertsPaused,
    },
    voice,
  );

  const pollState = uiStatusPollLine(status.lastPollAt, voice);

  const tpLine = uiStatusTpLine(status, voice);

  const watchLabels = status.watched
    .map((w) => {
      const short =
        w.symbol.split(':')[1]?.replace('-INDEX', '') ?? w.symbol;
      return `${short} · ${w.tradingStyle}`;
    })
    .join('\n');

  const statusBlock = joinTelegramLines(
    formatSectionHeader('info', uiStatusTitle(voice), '📡'),
    alertState,
    fyersState,
    marketState,
    uiStatusVoiceLine(voice),
  );

  const activityBlock = joinTelegramLines(
    pollState,
    status.lastPollError ? `⚠️ ${status.lastPollError}` : null,
    tpLine,
    status.alertsPaused && status.alertsPausedAt
      ? uiStatusPausedSince(status.alertsPausedAt, voice)
      : null,
    status.alertsPaused
      ? `<i>${uiStatusPausedNote(voice)}</i>`
      : null,
  );

  const watchBlock = watchLabels
    ? joinTelegramLines(`<b>${uiStatusWatchTitle(voice)}</b>`, watchLabels)
    : null;

  return joinTelegramSections(statusBlock, activityBlock, watchBlock);
}