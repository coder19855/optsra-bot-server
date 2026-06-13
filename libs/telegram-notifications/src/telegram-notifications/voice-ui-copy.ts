import { TelegramNotificationStatus } from '../types/telegram-notifications';
import { TelegramVoice } from '../types/telegram-voice';
import { NowMarketContext } from './now-formatter';

type Copy = Record<TelegramVoice, string>;

function pick(voice: TelegramVoice, copy: Copy): string {
  return copy[voice];
}

export function uiNowBanner(voice: TelegramVoice): string {
  return pick(voice, {
    trader: 'Right now',
    simple: 'Abhi market kya bol rahi hai',
    tapori: 'Bhai abhi scene kya hai',
    marathi: 'Aata market kay boltoy',
  });
}

export function uiNowMarketLine(ctx: NowMarketContext, voice: TelegramVoice): string {
  if (ctx.marketOpen) {
    return pick(voice, {
      trader: '🟢 Market open',
      simple: '🟢 Market khuli hai',
      tapori: '🟢 Market open hai bhai',
      marathi: '🟢 Market open aahe',
    });
  }
  if (ctx.preSessionWindow) {
    return pick(voice, {
      trader: '🌅 Pre-session window',
      simple: '🌅 Pre-session window',
      tapori: '🌅 Pre-session window',
      marathi: '🌅 Pre-session window',
    });
  }
  if (ctx.postSessionCoachWindow) {
    return pick(voice, {
      trader: '📚 Post-session coach window',
      simple: '📚 Post-session coach window',
      tapori: '📚 Post-session coach window',
      marathi: '📚 Post-session coach window',
    });
  }
  return pick(voice, {
    trader: '🌙 Outside market hours',
    simple: '🌙 Market band hai',
    tapori: '🌙 Market band hai bhai',
    marathi: '🌙 Market band aahe',
  });
}

export function uiNowFyersLine(valid: boolean, voice: TelegramVoice): string {
  if (valid) {
    return pick(voice, {
      trader: '✅ Fyers session live',
      simple: '✅ Fyers connected hai',
      tapori: '✅ Fyers live hai bhai',
      marathi: '✅ Fyers session live aahe',
    });
  }
  return pick(voice, {
    trader: '⚠️ Fyers not connected — /login',
    simple: '⚠️ Fyers connect nahi — /login karo',
    tapori: '⚠️ Fyers so raha hai — /login maar',
    marathi: '⚠️ Fyers connect nahi — /login kara',
  });
}

export function uiNowAlertsLine(paused: boolean, voice: TelegramVoice): string {
  if (paused) {
    return pick(voice, {
      trader: '⏸ Auto alerts paused — /start to resume',
      simple: '⏸ Auto alerts band — /start se resume',
      tapori: '⏸ Auto alerts pause — /start se chalu kar',
      marathi: '⏸ Auto alerts pause — /start ne resume kara',
    });
  }
  return pick(voice, {
    trader: '▶️ Auto alerts active',
    simple: '▶️ Auto alerts chal rahe hain',
    tapori: '▶️ Auto alerts on hai',
    marathi: '▶️ Auto alerts active aahet',
  });
}

export function uiNowClosedNote(voice: TelegramVoice): string {
  return pick(voice, {
    trader: 'Market closed — read is informational, not a live alert.',
    simple: 'Market band hai — yeh sirf info hai, live alert nahi.',
    tapori: 'Market band hai bhai — info hai, alert nahi.',
    marathi: 'Market band aahe — he info aahe, live alert nahi.',
  });
}

export function uiNowEnterBarMet(met: boolean, voice: TelegramVoice): string {
  if (met) {
    return pick(voice, {
      trader: '✅ Meets enter bar',
      simple: '✅ Enter bar clear hai',
      tapori: '✅ Enter bar clear hai bhai',
      marathi: '✅ Enter bar clear aahe',
    });
  }
  return pick(voice, {
    trader: '⚠️ Below enter bar — wait or size down',
    simple: '⚠️ Enter bar se neeche — wait karo ya size kam',
    tapori: '⚠️ Enter bar se neeche — ruk ya chhota size',
    marathi: '⚠️ Enter bar khali — wait kara ki size kami kara',
  });
}

export function uiNowFooter(voice: TelegramVoice): string {
  return pick(voice, {
    trader: 'On-demand snapshot — not an alert. Detail: /why live',
    simple: 'Yeh snapshot hai, alert nahi. Detail: /why live',
    tapori: 'Snapshot hai bhai, alert nahi. Detail: /why live',
    marathi: 'He snapshot aahe, alert nahi. Detail: /why live',
  });
}

export function uiWhyTitle(
  voice: TelegramVoice,
  params: { isAlert: boolean; label: string; style: string },
): string {
  if (params.isAlert) {
    return pick(voice, {
      trader: `Why · ${params.label} · ${params.style}`,
      simple: `Kyun alert aaya · ${params.label} · ${params.style}`,
      tapori: `Kyun ping aaya bhai · ${params.label} · ${params.style}`,
      marathi: `Ka alert aala · ${params.label} · ${params.style}`,
    });
  }
  return pick(voice, {
    trader: `Live · ${params.label} · ${params.style}`,
    simple: `Live read · ${params.label} · ${params.style}`,
    tapori: `Live scene · ${params.label} · ${params.style}`,
    marathi: `Live read · ${params.label} · ${params.style}`,
  });
}

export function uiWhyNoAlert(voice: TelegramVoice): string {
  return pick(voice, {
    trader: 'No alert fired — live snapshot.',
    simple: 'Alert nahi aaya — live snapshot hai.',
    tapori: 'Alert nahi aaya bhai — live snapshot.',
    marathi: 'Alert nahi aala — live snapshot aahe.',
  });
}

export function uiWhySidelines(voice: TelegramVoice): string {
  return pick(voice, {
    trader: 'Sidelines — no strike pick.',
    simple: 'Abhi side mein — koi strike pick nahi.',
    tapori: 'Side mein ho bhai — strike pick nahi.',
    marathi: 'Sidelines — strike pick nahi.',
  });
}

export function uiStatusAlertState(paused: boolean, voice: TelegramVoice): string {
  if (paused) {
    return pick(voice, {
      trader: '⏸ Paused — no signal or pre-session pings',
      simple: '⏸ Pause — signal alerts band',
      tapori: '⏸ Pause — signal pings band',
      marathi: '⏸ Pause — signal alerts band',
    });
  }
  return pick(voice, {
    trader: '▶️ Active — watching for signal flips',
    simple: '▶️ Active — signal change dekh raha hai',
    tapori: '▶️ Active — signal flip pakad raha hai',
    marathi: '▶️ Active — signal change baghtoy',
  });
}

export function uiStatusTitle(voice: TelegramVoice): string {
  return pick(voice, {
    trader: 'Bot status',
    simple: 'Bot status',
    tapori: 'Bot status',
    marathi: 'Bot status',
  });
}

export function uiStatusVoiceLine(voice: TelegramVoice): string {
  return pick(voice, {
    trader: `🎙 Voice: ${voiceLabel(voice)}`,
    simple: `🎙 Alert style: ${voiceLabel(voice)}`,
    tapori: `🎙 Bolne ka style: ${voiceLabel(voice)}`,
    marathi: `🎙 Alert style: ${voiceLabel(voice)}`,
  });
}

function voiceLabel(voice: TelegramVoice): string {
  switch (voice) {
    case 'trader':
      return 'English';
    case 'simple':
      return 'Hindi';
    case 'tapori':
      return 'Tapori';
    case 'marathi':
      return 'Marathi-English';
  }
}

export function uiCoachBanner(onDemand: boolean, voice: TelegramVoice): string {
  if (onDemand) {
    return pick(voice, {
      trader: 'Coach',
      simple: 'Aaj ke trades ka review',
      tapori: 'Bhai aaj ke trades ka check',
      marathi: 'Aajche trades review',
    });
  }
  return pick(voice, {
    trader: 'Day wrap',
    simple: 'Din ka wrap-up',
    tapori: 'Din ka wrap bhai',
    marathi: 'Dinacha wrap-up',
  });
}

export function uiLearningBanner(preamble: boolean, voice: TelegramVoice): string {
  if (preamble) {
    return pick(voice, {
      trader: 'Pre-session brief',
      simple: 'Session se pehle ki summary',
      tapori: 'Session se pehle ka scene',
      marathi: 'Session aadhi summary',
    });
  }
  return pick(voice, {
    trader: 'Your trade lessons',
    simple: 'Tumhare trade lessons',
    tapori: 'Tere trade lessons bhai',
    marathi: 'Tumche trade lessons',
  });
}

export function uiLearningLeaksTitle(voice: TelegramVoice): string {
  return pick(voice, {
    trader: 'Leaks',
    simple: 'Galtiyan',
    tapori: 'Leak points',
    marathi: 'Chukicha pattern',
  });
}

export function uiLearningStrengthsTitle(voice: TelegramVoice): string {
  return pick(voice, {
    trader: 'Strengths',
    simple: 'Achhi aadatein',
    tapori: 'Strong points',
    marathi: 'Changale habits',
  });
}

export function uiLearningTodayTitle(voice: TelegramVoice): string {
  return pick(voice, {
    trader: 'Today',
    simple: 'Aaj kya dhyaan rakhein',
    tapori: 'Aaj ka focus',
    marathi: 'Aaj kay lakshaat thevaycha',
  });
}

export function uiStatusFyersTokenMissing(voice: TelegramVoice): string {
  return pick(voice, {
    trader: '⚠️ Fyers token missing or expired — <code>/login</code>',
    simple: '⚠️ Fyers token missing/expired — <code>/login</code> karo',
    tapori: '⚠️ Fyers token missing/expired — <code>/login</code> maar',
    marathi: '⚠️ Fyers token missing/expired — <code>/login</code> kara',
  });
}

export function uiStatusPollLine(
  lastPollAt: string | null,
  voice: TelegramVoice,
): string {
  if (!lastPollAt) {
    return pick(voice, {
      trader: 'No poll yet this boot',
      simple: 'Is boot mein abhi poll nahi hua',
      tapori: 'Is boot mein abhi poll nahi hua bhai',
      marathi: 'Ya boot madhe poll nahi zala',
    });
  }
  const time = new Date(lastPollAt).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
  return pick(voice, {
    trader: `Last poll ${time}`,
    simple: `Last poll ${time}`,
    tapori: `Last poll ${time}`,
    marathi: `Last poll ${time}`,
  });
}

export function uiStatusPausedSince(
  pausedAt: string,
  voice: TelegramVoice,
): string {
  const time = new Date(pausedAt).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
  return pick(voice, {
    trader: `Paused since ${time} — <code>/start</code> or <code>/login</code> to resume`,
    simple: `${time} se pause — resume ke liye <code>/start</code> ya <code>/login</code>`,
    tapori: `${time} se pause bhai — <code>/start</code> ya <code>/login</code> se chalu kar`,
    marathi: `${time} pasun pause — <code>/start</code> ki <code>/login</code> ne resume kara`,
  });
}

export function uiStatusPausedNote(voice: TelegramVoice): string {
  return pick(voice, {
    trader: 'TP/hold nudges and commands still work while paused.',
    simple: 'Pause mein bhi TP/hold aur commands chalenge.',
    tapori: 'Pause mein bhi TP/hold aur commands chalenge bhai.',
    marathi: 'Pause madhe pan TP/hold ani commands chaltat.',
  });
}

export function uiStatusWatchTitle(voice: TelegramVoice): string {
  return pick(voice, {
    trader: 'On watch',
    simple: 'Watch list',
    tapori: 'Watch list',
    marathi: 'Watch list',
  });
}

export function uiWhyConvictionStack(voice: TelegramVoice): string {
  return pick(voice, {
    trader: 'Conviction stack',
    simple: 'Conviction stack',
    tapori: 'Conviction stack',
    marathi: 'Conviction stack',
  });
}

export function uiWhyPriceAction(voice: TelegramVoice): string {
  return pick(voice, {
    trader: 'Price action',
    simple: 'Chart read',
    tapori: 'Chart read',
    marathi: 'Chart read',
  });
}

export function uiWhyOptionFlow(voice: TelegramVoice): string {
  return pick(voice, {
    trader: 'Option flow',
    simple: 'Option flow',
    tapori: 'Option flow',
    marathi: 'Option flow',
  });
}

export function uiWhyCaution(voice: TelegramVoice): string {
  return pick(voice, {
    trader: 'Caution',
    simple: 'Sawdhani',
    tapori: 'Dhyan rakh',
    marathi: 'Savadhan',
  });
}

export function uiWhyStrike(voice: TelegramVoice): string {
  return pick(voice, {
    trader: 'STRIKE',
    simple: 'STRIKE',
    tapori: 'STRIKE',
    marathi: 'STRIKE',
  });
}

export function uiNowTopPlaybook(strategy: string, score: number | null, voice: TelegramVoice): string {
  const scorePart = score != null ? ` · ${score}%` : '';
  return pick(voice, {
    trader: `🎲 Top playbook: <b>${strategy}</b>${scorePart}`,
    simple: `🎲 Top playbook: <b>${strategy}</b>${scorePart}`,
    tapori: `🎲 Top playbook: <b>${strategy}</b>${scorePart}`,
    marathi: `🎲 Top playbook: <b>${strategy}</b>${scorePart}`,
  });
}

export function uiNowNoStrike(voice: TelegramVoice): string {
  return pick(voice, {
    trader: 'No strike pick — chain data thin',
    simple: 'Strike pick nahi — chain data kam hai',
    tapori: 'Strike pick nahi bhai — chain data kam hai',
    marathi: 'Strike pick nahi — chain data thin',
  });
}

export function uiLearningTradeSummary(params: {
  lookbackDays: number;
  totalTrades: number;
  verdicts: { good: number; bad: number; ugly: number };
  voice: TelegramVoice;
}): string {
  const { lookbackDays, totalTrades, verdicts, voice } = params;
  if (totalTrades > 0) {
    const stats = `${lookbackDays}d · ${totalTrades} trades · ✅${verdicts.good} ⚠️${verdicts.bad} 🚨${verdicts.ugly}`;
    return stats;
  }
  return pick(voice, {
    trader: `${lookbackDays}d · no closed trades yet`,
    simple: `${lookbackDays} din · abhi koi closed trade nahi`,
    tapori: `${lookbackDays} din · abhi koi closed trade nahi bhai`,
    marathi: `${lookbackDays} divas · closed trades nahi`,
  });
}

export function uiLearningEmptyLeaks(voice: TelegramVoice): string {
  return pick(voice, {
    trader: 'No repeat leaks tagged.',
    simple: 'Koi repeat galti tag nahi hui.',
    tapori: 'Koi repeat leak tag nahi hua bhai.',
    marathi: 'Repeat leak tag nahi.',
  });
}

export function uiLearningEmptyStrengths(voice: TelegramVoice): string {
  return pick(voice, {
    trader: 'Keep taking engine-approved entries.',
    simple: 'Engine-approved entries lete raho.',
    tapori: 'Engine-approved entries lete reh bhai.',
    marathi: 'Engine-approved entries ghet rahaa.',
  });
}

export function uiLearningRemindersTitle(voice: TelegramVoice): string {
  return pick(voice, {
    trader: 'Reminders',
    simple: 'Yaad rakho',
    tapori: 'Yaad rakh',
    marathi: 'Lakshaat theva',
  });
}

export function uiLearningHeadlinesTitle(voice: TelegramVoice): string {
  return pick(voice, {
    trader: 'Headlines',
    simple: 'Headlines',
    tapori: 'Headlines',
    marathi: 'Headlines',
  });
}

export function uiLearningFooter(voice: TelegramVoice): string {
  return pick(voice, {
    trader: 'Full detail: <code>/learning</code>',
    simple: 'Poori detail: <code>/learning</code>',
    tapori: 'Poori detail: <code>/learning</code>',
    marathi: 'Sampurn detail: <code>/learning</code>',
  });
}

export function uiStatusTpLine(status: TelegramNotificationStatus, voice: TelegramVoice): string {
  if (status.openPositionsTracked > 0) {
    return pick(voice, {
      trader: `🎯 TP tracking ${status.openPositionsTracked} position(s) (${status.openPositionsMonitored} monitored)`,
      simple: `🎯 TP track: ${status.openPositionsTracked} position (${status.openPositionsMonitored} dekh raha)`,
      tapori: `🎯 TP track: ${status.openPositionsTracked} position pe nazar`,
      marathi: `🎯 TP track: ${status.openPositionsTracked} position`,
    });
  }
  if (status.openPositionsMonitored > 0) {
    return pick(voice, {
      trader: `${status.openPositionsMonitored} open position(s) — none on TP track yet`,
      simple: `${status.openPositionsMonitored} open position — TP track abhi nahi`,
      tapori: `${status.openPositionsMonitored} position open — TP track nahi hua abhi`,
      marathi: `${status.openPositionsMonitored} open position — TP track nahi`,
    });
  }
  return pick(voice, {
    trader: 'No open positions on watch',
    simple: 'Koi open position nahi',
    tapori: 'Koi open position nahi bhai',
    marathi: 'Open position nahi',
  });
}