import { TradingStyle } from '../types/trading-style';
import { parseTradingStyleArg } from './command-args';
import { joinTelegramLines, joinTelegramSections } from './message-layout';

export function tradingStyleLabel(style: TradingStyle): string {
  switch (style) {
    case TradingStyle.Scalper:
      return 'Scalper';
    case TradingStyle.Positional:
      return 'Positional';
    default:
      return 'Intraday';
  }
}

export function tradingStyleDetail(style: TradingStyle): string {
  switch (style) {
    case TradingStyle.Scalper:
      return '5m price action · local option-chain cluster · faster entries';
    case TradingStyle.Positional:
      return '1h price action · swing-style thresholds · wider holds';
    default:
      return '15m price action · balanced intraday thresholds (default)';
  }
}

export function formatStyleStatusMessage(tradingStyle: TradingStyle): string {
  const label = tradingStyleLabel(tradingStyle);
  const detail = tradingStyleDetail(tradingStyle);

  return joinTelegramSections(
    '🎯 <b>Trading style</b>',
    joinTelegramLines(`Current: <b>${label}</b>`, detail, ''),
    joinTelegramLines(
      '<code>/style intraday</code> — 15m structure (default)',
      '<code>/style scalper</code> — 5m quick reads',
      '<code>/style positional</code> — 1h swing bias',
      '<code>/style status</code> — show current style',
      '',
      '<i>Affects alerts, /now, deck links, coach, and TP coaching.</i>',
    ),
  );
}

export function parseStyleCommandArgs(text: string): {
  action: 'status' | TradingStyle;
} {
  const parts = text.trim().toLowerCase().split(/\s+/);
  const arg = parts[1];

  if (!arg || arg === 'status') return { action: 'status' };

  const fromEnum = parseTradingStyleArg(arg.toUpperCase());
  if (fromEnum) return { action: fromEnum };

  if (arg === 'scalp' || arg === '5m') {
    return { action: TradingStyle.Scalper };
  }
  if (arg === 'intra' || arg === '15m') {
    return { action: TradingStyle.Intraday };
  }
  if (arg === 'pos' || arg === 'swing' || arg === '1h') {
    return { action: TradingStyle.Positional };
  }

  return { action: 'status' };
}