import axios from 'axios';
import { TELEGRAM_API_BASE } from '../constants/telegram-notifications';
import { TradingStyle } from '../types/trading-style';
import { joinTelegramLines, joinTelegramSections } from './message-layout';

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

function commandBlock(
  title: string,
  lines: Array<string | null | undefined>,
): string {
  return joinTelegramLines(title, ...lines);
}

export function formatCommandsReferenceMessage(
  ctx: CommandsReferenceContext,
): string {
  const sym = exampleSymbol(ctx.watchedSymbols);
  const style = exampleStyle(ctx.watchedStyles);
  const today = new Date().toLocaleDateString('en-CA', {
    timeZone: 'Asia/Kolkata',
  });

  const intro = joinTelegramLines(
    '📌 <b>Your trading sidekick</b>',
    '<i>Lost? Type <code>/help</code> anytime.</i>',
  );

  const whyBlock = commandBlock('🔍 <b>“Why did it ping me?”</b>', [
    '<code>/why</code> — full breakdown of the latest read',
    `<i>Try:</i> <code>/why</code> · <code>/why live</code> · <code>/why ${sym} ${style}</code>`,
  ]);

  const coachBlock = commandBlock('📚 <b>Grade today’s trades</b>', [
    '<code>/coach</code> — tradebook replay + entry/exit coaching',
    `<i>Try:</i> <code>/coach</code> · <code>/coach ${style}</code> · <code>/coach ${today}</code>`,
  ]);

  const newsBlock = commandBlock('📰 <b>Market headlines</b>', [
    '<code>/news</code> — headlines from your active feed (tap to open)',
    '<code>/newsfeed status</code> — Google multi-source vs CNBC-TV18 economy',
    '<code>/newsfeed google</code> — Mint, ET, Reuters… (default)',
    '<code>/newsfeed cnbc</code> — CNBC-TV18 economy desk',
    '<i>Try:</i> <code>/news</code> · <code>/news 10</code>',
  ]);

  const learningBlock = commandBlock('🧠 <b>Don’t repeat mistakes</b>', [
    '<code>/learning</code> — your leaks &amp; good habits from recent trades',
    '<i>Try:</i> <code>/learning</code> · <code>/learning 14</code>',
  ]);

  const outcomesBlock = commandBlock('📊 <b>Paper scoreboard</b>', [
    '<code>/outcomes</code> — how past alerts would’ve done',
    '<i>Try:</i> <code>/outcomes</code>',
  ]);

  const convictionBlock = commandBlock('📈 <b>Your personal enter bar</b>', [
    '<code>/conviction</code> — win-rate by conviction bucket',
    `<i>Try:</i> <code>/conviction</code> · <code>/conviction PE ${sym} ${style}</code>`,
  ]);

  const planBlock = commandBlock('📐 <b>Plan the trade</b>', [
    '<code>/rr</code> — entry, stop, 1:1 / 1:2 / 1:3 targets',
    `<i>Try:</i> <code>/rr ${sym} ${style}</code>`,
    '<code>/size</code> — lots from balance + stop risk',
    `<i>Try:</i> <code>/size</code> · <code>/size ${sym} ${style}</code>`,
    '<code>/beststrike</code> — 🤯 gamma blast + 🎯 engine pick &amp; Greeks',
    `<i>Try:</i> <code>/beststrike ${sym} ${style}</code> · <code>/beststrike CE</code>`,
  ]);

  const nowBlock = commandBlock('📡 <b>Live market read</b>', [
    '<code>/now</code> — current recommendation (all on watch)',
    `<i>Try:</i> <code>/now ${sym} ${style}</code>`,
  ]);

  const styleBlock = commandBlock('🎯 <b>Trading style</b>', [
    '<code>/style status</code> — intraday / scalper / positional',
    '<code>/style intraday</code> — 15m structure (default)',
    '<code>/style scalper</code> — 5m quick reads',
    '<code>/style positional</code> — 1h swing bias',
  ]);

  const vetoBlock = commandBlock('⛔ <b>Chart veto (what-if)</b>', [
    '<code>/veto status</code> — strict / relaxed / off',
    '<code>/veto strict</code> — full chart vetoes (default)',
    '<code>/veto relaxed</code> — hard decay only, softer option gates',
    '<code>/veto off</code> — bypass all vetoes (research)',
    '<code>/veto on</code> — alias for strict',
  ]);

  const flowBlock = commandBlock('📊 <b>Flow scoring</b>', [
    '<code>/flow status</code> — pa / option / blend',
    '<code>/flow pa</code> — price action only',
    '<code>/flow option</code> — option flow only',
    '<code>/flow blend</code> — PA + options (default)',
    '<code>/flow on</code> — alias for blend',
  ]);

  const voiceBlock = commandBlock('🎙 <b>Alert personality</b>', [
    '<code>/voice</code> — current style',
    '<code>/voice trader</code> — English · jargon',
    '<code>/voice simple</code> — Hindi · easy',
    '<code>/voice tapori</code> — Hinglish · bhai mode',
    '<code>/voice marathi</code> — Marathi-English mix',
    '<code>/voice preview</code> — sample all four',
  ]);

  const alertFormatBlock = commandBlock('🔔 <b>Alert length</b>', [
    '<code>/alert status</code> — full vs compact',
    '<code>/alert full</code> — PA, Greeks, playbook in chat (default)',
    '<code>/alert compact</code> — short ping + Deck for detail',
  ]);

  const alertsBlock = commandBlock('⏯ <b>Alert cool-off</b>', [
    '<code>/stop</code> — pause signal + pre-session pings (TP still on)',
    '<code>/start</code> — resume alerts (needs live Fyers session)',
    '<code>/status</code> — bot health (polls, TP, Fyers token)',
  ]);

  const fyersBlock = commandBlock('🔐 <b>Fyers session</b>', [
    '<code>/login</code> — login link (opens browser; auto-resumes alerts)',
  ]);

  const apiBlock = commandBlock('🌡 <b>API budget</b>', [
    '<code>/apiusage</code> — Fyers rate limits &amp; what we’ve consumed',
    '<i>Try:</i> <code>/apiusage</code>',
  ]);

  const clearBlock = commandBlock('🧹 <b>Clean the chat</b>', [
    '<code>/clear</code> — delete bot messages above this command',
    '<i>Try:</i> <code>/clear 30</code>',
  ]);

  const helpBlock = commandBlock('🆘 <b>Cheat sheet</b>', [
    '<code>/help</code> or <code>/commands</code>',
  ]);

  const autoPings = joinTelegramLines(
    '💡 <b>Auto pings</b> (no command needed)',
    '• 09:00–09:20 IST → pre-session learning brief',
    '• Signal flips → signal chat',
    '• TP / hold nudges → TP chat',
    '• After 15:30 IST → end-of-day coach',
  );

  const footer = joinTelegramLines(
    `👀 <b>On watch:</b> ${ctx.watchedSymbols.map((s) => s.split(':')[1]?.replace('-INDEX', '') ?? s).join(', ')} · ${ctx.watchedStyles.join(', ')}`,
    '🎨 <b>Icon key</b>',
    '📈 bullish · 📉 bearish · ✅ wins · ⚠️ caution · 🤯 gamma blast · 🎯 engine pick · 📚 coach · 🧠 learning',
  );

  return joinTelegramSections(
    intro,
    whyBlock,
    coachBlock,
    newsBlock,
    learningBlock,
    outcomesBlock,
    convictionBlock,
    planBlock,
    nowBlock,
    styleBlock,
    vetoBlock,
    flowBlock,
    voiceBlock,
    alertFormatBlock,
    alertsBlock,
    fyersBlock,
    apiBlock,
    clearBlock,
    helpBlock,
    autoPings,
    footer,
  );
}

export const TELEGRAM_BOT_COMMANDS = [
  { command: 'start', description: 'Resume signal alerts' },
  { command: 'stop', description: 'Pause signal alerts' },
  { command: 'now', description: 'Live market recommendation' },
  { command: 'voice', description: 'Alert language & style' },
  { command: 'alert', description: 'Full vs compact signal pings' },
  { command: 'style', description: 'Intraday / scalper / positional' },
  { command: 'veto', description: 'Chart veto what-if mode' },
  { command: 'flow', description: 'PA-only vs blend scoring' },
  { command: 'status', description: 'Bot & alert status' },
  { command: 'why', description: 'Why did this alert fire?' },
  { command: 'coach', description: "Grade today's trades" },
  { command: 'news', description: 'Market headlines with links' },
  { command: 'newsfeed', description: 'Switch Google / CNBC feed' },
  { command: 'learning', description: 'Habits from your trades' },
  { command: 'login', description: 'Wake up Fyers session' },
  { command: 'apiusage', description: 'Fyers API consumption' },
  { command: 'clear', description: 'Tidy bot messages' },
  { command: 'outcomes', description: 'Paper alert scoreboard' },
  { command: 'conviction', description: 'Your enter threshold' },
  { command: 'rr', description: 'Risk / reward map' },
  { command: 'size', description: 'How many lots?' },
  { command: 'beststrike', description: 'Gamma blast & engine pick' },
  { command: 'help', description: 'Command cheat sheet' },
  { command: 'commands', description: 'Re-send cheat sheet' },
] as const;

export async function ensureTelegramPollingMode(botToken: string): Promise<void> {
  if (!botToken) return;
  await axios.post(`${TELEGRAM_API_BASE}/bot${botToken}/deleteWebhook`, {
    drop_pending_updates: false,
  });
}

export async function registerTelegramBotCommands(botToken: string): Promise<void> {
  if (!botToken) return;
  await ensureTelegramPollingMode(botToken);
  await axios.post(`${TELEGRAM_API_BASE}/bot${botToken}/setMyCommands`, {
    commands: TELEGRAM_BOT_COMMANDS.map((c) => ({
      command: c.command,
      description: c.description,
    })),
  });
}