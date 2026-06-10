import axios from 'axios';
import { TELEGRAM_API_BASE } from '../constants/telegram-notifications';
import { TradingStyle } from '../types/trading-style';
import { TELEGRAM_MSG_RULE } from './message-layout';

export interface CommandsReferenceContext {
  watchedSymbols: string[];
  watchedStyles: TradingStyle[];
}

function exampleSymbol(symbols: string[]): string {
  const sym = symbols[0] ?? 'NSE:NIFTY50-INDEX';
  const short = sym.split(':')[1]?.replace('-INDEX', '') ?? 'NIFTY50';
  return short;
}

function exampleStyle(styles: TradingStyle[]): string {
  return styles[0] ?? TradingStyle.Intraday;
}

export function formatCommandsReferenceMessage(
  ctx: CommandsReferenceContext,
): string {
  const sym = exampleSymbol(ctx.watchedSymbols);
  const style = exampleStyle(ctx.watchedStyles);
  const today = new Date().toLocaleDateString('en-CA', {
    timeZone: 'Asia/Kolkata',
  });

  return [
    '📌 <b>Commands</b>',
    '<i>/help anytime to show this again.</i>',
    TELEGRAM_MSG_RULE,
    '',
    '🔍 <b>Understand a signal</b>',
    '<code>/why</code> — breakdown of the latest engine read',
    `<i>Example:</i> <code>/why</code>`,
    `<i>Example:</i> <code>/why live</code>  ← fresh read, no alert needed`,
    `<i>Example:</i> <code>/why ${sym} ${style}</code>`,
    '',
    '📚 <b>Review today’s trades</b>',
    '<code>/coach</code> — Fyers tradebook + entry/exit coaching',
    `<i>Example:</i> <code>/coach</code>`,
    `<i>Example:</i> <code>/coach ${style}</code>`,
    `<i>Example:</i> <code>/coach ${today}</code>`,
    '',
    '📊 <b>Track alert performance (paper)</b>',
    '<code>/outcomes</code> — paper P&amp;L on past CE/PE alerts',
    '<i>Example:</i> <code>/outcomes</code>',
    '',
    '📈 <b>Your personalized conviction bar</b>',
    '<code>/conviction</code> — win-rate by conviction bucket',
    '<i>Example:</i> <code>/conviction</code>',
    `<i>Example:</i> <code>/conviction PE ${sym} ${style}</code>`,
    '',
    '📐 <b>Trade plan</b>',
    '<code>/rr</code> — entry, stop, and 1:1 / 1:2 / 1:3 targets',
    `<i>Example:</i> <code>/rr ${sym} ${style}</code>`,
    '<code>/size</code> — lots from Fyers balance + stop risk',
    `<i>Example:</i> <code>/size</code>`,
    `<i>Example:</i> <code>/size ${sym} ${style}</code>`,
    '',
    '🔐 <b>Fyers session</b>',
    '<code>/login</code> — login link (opens browser)',
    '',
    '🧹 <b>Tidy chat</b>',
    '<code>/clear</code> — delete bot messages above this command',
    '<i>Example:</i> <code>/clear 30</code>  ← up to 30 bot messages',
    '',
    '🆘 <b>Reference</b>',
    '<code>/help</code> or <code>/commands</code> — show this cheat sheet',
    '',
    TELEGRAM_MSG_RULE,
    '💡 <b>Auto alerts</b> (no command needed)',
    '• Signal flips → signal chat',
    '• TP / hold advice → TP chat',
    '• End-of-session coach → coach chat (after 15:30 IST)',
    '',
    `👀 <b>Watching:</b> ${ctx.watchedSymbols.map((s) => s.split(':')[1]?.replace('-INDEX', '') ?? s).join(', ')} · ${ctx.watchedStyles.join(', ')}`,
  ].join('\n');
}

export const TELEGRAM_BOT_COMMANDS = [
  { command: 'why', description: 'Explain a signal (last or live)' },
  { command: 'coach', description: "Today's trade review" },
  { command: 'login', description: 'Fyers login link' },
  { command: 'clear', description: 'Delete recent bot messages' },
  { command: 'outcomes', description: 'Paper P&L from past alerts' },
  { command: 'conviction', description: 'Your enter threshold' },
  { command: 'rr', description: 'Risk / reward levels' },
  { command: 'size', description: 'Position size from balance' },
  { command: 'help', description: 'Command cheat sheet' },
  { command: 'commands', description: 'Re-send cheat sheet' },
] as const;

export async function registerTelegramBotCommands(botToken: string): Promise<void> {
  if (!botToken) return;
  await axios.post(`${TELEGRAM_API_BASE}/bot${botToken}/setMyCommands`, {
    commands: TELEGRAM_BOT_COMMANDS.map((c) => ({
      command: c.command,
      description: c.description,
    })),
  });
}