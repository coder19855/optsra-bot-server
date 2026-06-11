import { TelegramSendOptions } from '../types/telegram-notifications';
import { buildDeckWebAppUrl, DeckMode } from './deck-url';

export function buildDeckInlineKeyboard(params: {
  symbol: string;
  tradingStyle: string;
  mode?: DeckMode;
  sessionDate?: string;
}): TelegramSendOptions['inlineKeyboard'] {
  const liveUrl = buildDeckWebAppUrl({ ...params, mode: 'live' });
  if (!liveUrl) return undefined;

  const replayUrl =
    params.mode === 'replay' || params.sessionDate
      ? buildDeckWebAppUrl({
          symbol: params.symbol,
          tradingStyle: params.tradingStyle,
          mode: 'replay',
          sessionDate: params.sessionDate,
        })
      : buildDeckWebAppUrl({
          symbol: params.symbol,
          tradingStyle: params.tradingStyle,
          mode: 'replay',
        });

  const row: NonNullable<TelegramSendOptions['inlineKeyboard']>[number] = [
    { text: '📊 Live deck', webAppUrl: liveUrl },
  ];
  if (replayUrl) {
    row.push({ text: '📚 Replay', webAppUrl: replayUrl });
  }
  return [row];
}

export function mergeDeckKeyboard(
  options: TelegramSendOptions | undefined,
  deckParams: {
    symbol: string;
    tradingStyle: string;
    sessionDate?: string;
    includeReplay?: boolean;
  },
): TelegramSendOptions {
  const deckRows = buildDeckInlineKeyboard({
    symbol: deckParams.symbol,
    tradingStyle: deckParams.tradingStyle,
    mode: deckParams.includeReplay ? 'replay' : 'live',
    sessionDate: deckParams.sessionDate,
  });
  if (!deckRows?.length) return options ?? {};

  return {
    ...options,
    inlineKeyboard: [...(options?.inlineKeyboard ?? []), ...deckRows],
  };
}