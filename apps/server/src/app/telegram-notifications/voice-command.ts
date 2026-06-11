import { TELEGRAM_VOICES, TelegramVoice } from '../types/telegram-voice';
import { joinTelegramLines, joinTelegramSections } from './message-layout';
import { parseTelegramVoiceArg } from './voice-preference';
import { voiceDisplayName, voicePreviewSamples } from './voice-copy';

export function formatVoiceStatusMessage(current: TelegramVoice): string {
  return joinTelegramSections(
    '🎙 <b>Alert voice</b>',
    joinTelegramLines(
      `Active: <b>${voiceDisplayName(current)}</b>`,
      '',
      '<code>/voice trader</code> — English · trading jargon',
      '<code>/voice simple</code> — Hindi · newcomers',
      '<code>/voice tapori</code> — Hinglish · bhai mode',
      '<code>/voice marathi</code> — Marathi-English mix',
      '',
      '<code>/voice preview</code> — taste all four styles',
    ),
  );
}

export function formatVoicePreviewMessage(): string {
  const blocks = TELEGRAM_VOICES.map((voice) => {
    const samples = voicePreviewSamples(voice);
    return joinTelegramLines(
      `<b>${voiceDisplayName(voice)}</b>`,
      ...samples.map((line) => `• ${line}`),
    );
  });

  return joinTelegramSections(
    '🎙 <b>Voice preview</b>',
    '<i>Signals, TP, /now, /why, /status, /learning, /coach, and session briefs use your chosen voice. Numbers &amp; symbols stay the same.</i>',
    ...blocks,
  );
}

export function parseVoiceCommandArgs(
  text: string,
): { action: 'status' | 'set' | 'preview'; voice?: TelegramVoice } {
  const parts = text.trim().split(/\s+/);
  const arg = parts[1]?.toLowerCase();

  if (!arg || arg === 'status') {
    return { action: 'status' };
  }
  if (arg === 'preview' || arg === 'samples') {
    return { action: 'preview' };
  }

  const voice = parseTelegramVoiceArg(arg);
  if (voice) {
    return { action: 'set', voice };
  }

  return { action: 'status' };
}