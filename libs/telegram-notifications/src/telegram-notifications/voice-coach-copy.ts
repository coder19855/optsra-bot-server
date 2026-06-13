import { TelegramVoice } from '../types/telegram-voice';

type Copy = Record<TelegramVoice, string>;
type LocalizedCopy = Pick<Copy, 'simple' | 'tapori' | 'marathi'>;

function pick(voice: TelegramVoice, copy: Copy): string {
  return copy[voice];
}

function pickLocalized(voice: TelegramVoice, copy: LocalizedCopy): string {
  if (voice === 'trader') return '';
  return copy[voice];
}

export function uiCoachPnlLabel(voice: TelegramVoice): string {
  return pick(voice, {
    trader: 'PnL:',
    simple: 'PnL:',
    tapori: 'PnL:',
    marathi: 'PnL:',
  });
}

export function uiCoachClosedLegsSummary(
  closed: number,
  open: number,
  voice: TelegramVoice,
): string {
  const openPart =
    open > 0
      ? pick(voice, {
          trader: ` · 📂 ${open} open`,
          simple: ` · 📂 ${open} abhi open`,
          tapori: ` · 📂 ${open} abhi open`,
          marathi: ` · 📂 ${open} aata open`,
        })
      : '';
  return pick(voice, {
    trader: `🏁 ${closed} closed leg(s)${openPart}`,
    simple: `🏁 ${closed} trade close hue${openPart}`,
    tapori: `🏁 ${closed} trade close hue bhai${openPart}`,
    marathi: `🏁 ${closed} trades close zale${openPart}`,
  });
}

export function uiCoachClosedLegsOnly(voice: TelegramVoice): string {
  return pick(voice, {
    trader: 'Closed legs only:',
    simple: 'Sirf closed legs:',
    tapori: 'Sirf closed legs:',
    marathi: 'Fakt closed legs:',
  });
}

export function uiCoachFyersAccountNet(voice: TelegramVoice): string {
  return pick(voice, {
    trader: 'Fyers account net:',
    simple: 'Fyers account ka net:',
    tapori: 'Fyers account ka net:',
    marathi: 'Fyers account net:',
  });
}

export function uiCoachNoClosedToday(voice: TelegramVoice): string {
  return pick(voice, {
    trader: '📭 No closed trades today',
    simple: '📭 Aaj koi closed trade nahi',
    tapori: '📭 Aaj koi closed trade nahi bhai',
    marathi: '📭 Aaj closed trades nahi',
  });
}

export function uiCoachNoClosedAcrossStyles(voice: TelegramVoice): string {
  return pick(voice, {
    trader: '📭 No closed trades across your watched styles.',
    simple: '📭 Tumhari watch list pe koi closed trade nahi.',
    tapori: '📭 Teri watch list pe koi closed trade nahi bhai.',
    marathi: '📭 Watch list var closed trades nahi.',
  });
}

export function uiCoachOpenNoClosedYet(count: number, voice: TelegramVoice): string {
  return pick(voice, {
    trader: `📂 ${count} position(s) still open — no closed legs yet`,
    simple: `📂 ${count} position open — abhi koi close nahi hua`,
    tapori: `📂 ${count} position open bhai — abhi close nahi hua`,
    marathi: `📂 ${count} position open — closed legs nahi`,
  });
}

export function uiCoachFillsLoggedNothingClosed(voice: TelegramVoice): string {
  return pick(voice, {
    trader: '📭 Fills logged — nothing closed yet',
    simple: '📭 Fills aaye — abhi close nahi hua',
    tapori: '📭 Fills aa gaye bhai — abhi close nahi hua',
    marathi: '📭 Fills aale — closed nahi',
  });
}

export function uiCoachNoFillsToday(voice: TelegramVoice): string {
  return pick(voice, {
    trader: '📭 No fills today',
    simple: '📭 Aaj koi fill nahi',
    tapori: '📭 Aaj koi fill nahi bhai',
    marathi: '📭 Aaj fills nahi',
  });
}

export function uiCoachPositionsStillOpen(count: number, voice: TelegramVoice): string {
  return pick(voice, {
    trader: `📂 ${count} position(s) still open`,
    simple: `📂 ${count} position abhi open`,
    tapori: `📂 ${count} position abhi open bhai`,
    marathi: `📂 ${count} position open`,
  });
}

export function uiCoachFillsNothingClosed(count: number, voice: TelegramVoice): string {
  return pick(voice, {
    trader: `📭 ${count} fill(s) — nothing closed yet`,
    simple: `📭 ${count} fill — abhi close nahi`,
    tapori: `📭 ${count} fill bhai — abhi close nahi`,
    marathi: `📭 ${count} fills — closed nahi`,
  });
}

export function uiCoachTradesTitle(voice: TelegramVoice): string {
  return pick(voice, {
    trader: 'Trades',
    simple: 'Aaj ke trades',
    tapori: 'Aaj ke trades',
    marathi: 'Aajche trades',
  });
}

export function uiCoachStillOpenTitle(voice: TelegramVoice): string {
  return pick(voice, {
    trader: 'Still open',
    simple: 'Abhi open',
    tapori: 'Abhi open bhai',
    marathi: 'Aata open',
  });
}

export function uiCoachSignalsTitle(voice: TelegramVoice): string {
  return pick(voice, {
    trader: 'Signals',
    simple: 'Signals',
    tapori: 'Signals',
    marathi: 'Signals',
  });
}

export function uiCoachNoSignalsToday(voice: TelegramVoice): string {
  return pick(voice, {
    trader: '📡 No signals logged today.',
    simple: '📡 Aaj koi signal log nahi hua.',
    tapori: '📡 Aaj koi signal log nahi hua bhai.',
    marathi: '📡 Aaj signal log nahi zala.',
  });
}

export function uiCoachStylePnlLine(params: {
  voice: TelegramVoice;
  pnlText: string;
  winCount: number;
  lossCount: number;
  good: number;
  bad: number;
  ugly: number;
  closedLegsOnly?: boolean;
}): string {
  const stats = `🏁 ${params.winCount}W/${params.lossCount}L · ✅${params.good} ⚠️${params.bad} 🚨${params.ugly}`;
  if (params.closedLegsOnly) {
    const prefix = pick(params.voice, {
      trader: 'Closed legs',
      simple: 'Closed legs',
      tapori: 'Closed legs',
      marathi: 'Closed legs',
    });
    return `💰 ${prefix} ${params.pnlText} · ${stats}`;
  }
  return `💰 ${params.pnlText} · ${stats}`;
}

export function uiCoachMoreTrades(count: number, voice: TelegramVoice): string {
  return pick(voice, {
    trader: `… +${count} more trade(s) — full detail in /api/trading-coach`,
    simple: `… +${count} aur trade — detail /api/trading-coach`,
    tapori: `… +${count} aur trade bhai — detail /api/trading-coach`,
    marathi: `… +${count} anik trades — detail /api/trading-coach`,
  });
}

export function uiCoachEntryWindow(label: string, voice: TelegramVoice): string {
  return pick(voice, {
    trader: `🕐 <b>${label}</b> entry window`,
    simple: `🕐 <b>${label}</b> entry window`,
    tapori: `🕐 <b>${label}</b> entry time`,
    marathi: `🕐 <b>${label}</b> entry window`,
  });
}

export function uiCoachOffScript(voice: TelegramVoice): string {
  return pick(voice, {
    trader: '⚠️ off-script',
    simple: '⚠️ script ke bahar',
    tapori: '⚠️ script ke bahar',
    marathi: '⚠️ script baher',
  });
}

export function uiCoachAvgPremium(voice: TelegramVoice): string {
  return pick(voice, {
    trader: 'avg',
    simple: 'avg',
    tapori: 'avg',
    marathi: 'avg',
  });
}

export function uiCoachTrimmed(voice: TelegramVoice): string {
  return pick(voice, {
    trader: '… trimmed — Telegram has a size limit',
    simple: '… trimmed — Telegram size limit',
    tapori: '… trimmed bhai — Telegram size limit',
    marathi: '… trimmed — Telegram size limit',
  });
}

export function buildCoachSessionTakeaway(
  params: {
    summary: {
      totalRoundTrips: number;
      verdicts: { good: number; ugly: number };
      analyzed: number;
      systemApprovedCount: number;
    };
    uglyCount: number;
    luckyWinCount: number;
    earlyExitCount: number;
  },
  voice: TelegramVoice,
): string {
  const { summary, uglyCount, luckyWinCount, earlyExitCount } = params;

  if (summary.totalRoundTrips === 0) {
    return pick(voice, {
      trader:
        'Flat day — no trades to roast. Use the signal snapshot to plan tomorrow’s watchlist.',
      simple:
        'Aaj flat day — koi trade nahi. Kal ke liye signal snapshot dekho.',
      tapori:
        'Aaj flat day bhai — koi trade nahi. Kal ke liye signal snapshot dekh.',
      marathi:
        'Aaj flat day — trades nahi. Udyasathi signal snapshot bagha.',
    });
  }

  const parts: string[] = [];

  if (summary.verdicts.good > 0 && summary.verdicts.ugly === 0) {
    parts.push(
      pick(voice, {
        trader:
          'Clean sheet on discipline — rinse and repeat the approved-entry playbook.',
        simple:
          'Discipline clean sheet — approved-entry playbook repeat karo.',
        tapori:
          'Discipline clean sheet bhai — approved-entry playbook repeat kar.',
        marathi:
          'Discipline clean — approved-entry playbook repeat kara.',
      }),
    );
  } else if (summary.verdicts.ugly > 0) {
    parts.push(
      pick(voice, {
        trader: `${summary.verdicts.ugly} ugly trade(s) — plug the leaks before you size up.`,
        simple: `${summary.verdicts.ugly} ugly trade — size badhane se pehle leaks band karo.`,
        tapori: `${summary.verdicts.ugly} ugly trade bhai — size badhane se pehle leaks band kar.`,
        marathi: `${summary.verdicts.ugly} ugly trades — size vadhvaycha aadhi leaks band kara.`,
      }),
    );
  }

  if (uglyCount > 0) {
    parts.push(
      pick(voice, {
        trader:
          'Biggest leak: entries the engine didn’t bless — walk past those tomorrow.',
        simple:
          'Sabse badi galti: engine ne approve nahi kiya — kal unhe skip karo.',
        tapori:
          'Sabse badi leak bhai: engine ne approve nahi kiya — kal skip kar.',
        marathi:
          'Mothi chuk: engine ne approve nahi kele — udya te skip kara.',
      }),
    );
  }

  if (luckyWinCount > 0) {
    parts.push(
      pick(voice, {
        trader: `${luckyWinCount} lucky off-script win(s) — don’t let them fool you into loosening rules.`,
        simple: `${luckyWinCount} lucky off-script win — rules loose mat karo.`,
        tapori: `${luckyWinCount} lucky off-script win bhai — rules loose mat kar.`,
        marathi: `${luckyWinCount} lucky off-script wins — rules loose nako kara.`,
      }),
    );
  }

  if (earlyExitCount > 0) {
    parts.push(
      pick(voice, {
        trader: `${earlyExitCount} early bail(s) — spot kept paying after you left the party.`,
        simple: `${earlyExitCount} jaldi exit — spot baad mein bhi chala.`,
        tapori: `${earlyExitCount} jaldi exit bhai — spot baad mein bhi chala.`,
        marathi: `${earlyExitCount} lavkar exit — spot nantar pan chalala.`,
      }),
    );
  }

  if (summary.systemApprovedCount < summary.analyzed) {
    const offScript = summary.analyzed - summary.systemApprovedCount;
    parts.push(
      pick(voice, {
        trader: `${offScript} trade(s) started without engine approval.`,
        simple: `${offScript} trade engine approval ke bina start hue.`,
        tapori: `${offScript} trade bina engine approval ke start hue bhai.`,
        marathi: `${offScript} trades engine approval shivay start zale.`,
      }),
    );
  }

  if (parts.length) return parts.join(' ');

  return pick(voice, {
    trader:
      'Quick replay: did every entry earn its conviction and every exit earn its keep?',
    simple:
      'Quick check: har entry conviction ke layak thi aur har exit sahi tha?',
    tapori:
      'Quick check bhai: har entry conviction ke layak thi aur exit sahi tha?',
    marathi:
      'Quick check: pratyek entry conviction la yogya hota ka ani exit barobr hota ka?',
  });
}

export function translateCoachCoachingLine(
  line: string,
  voice: TelegramVoice,
): string {
  if (voice === 'trader') return line;

  if (
    line ===
    'You took a losing trade without a system-approved setup at entry. This is the main discipline leak to fix.'
  ) {
    return pickLocalized(voice, {
      simple:
        'System-approved setup ke bina losing trade — yeh main discipline leak hai.',
      tapori:
        'Bina system-approved setup ke losing trade bhai — yeh main leak hai.',
      marathi:
        'System-approved setup shivay losing trade — he mukhya discipline leak aahe.',
    });
  }

  if (
    line ===
    'System-approved setup that finished green. This is the process you want to repeat.'
  ) {
    return pickLocalized(voice, {
      simple: 'System-approved setup green close — yahi process repeat karo.',
      tapori: 'System-approved setup green close bhai — yahi process repeat kar.',
      marathi: 'System-approved setup green close — ha process repeat kara.',
    });
  }

  if (
    line ===
    'Valid system setup that lost. Review whether SL was honored and whether re-entry rules were respected.'
  ) {
    return pickLocalized(voice, {
      simple:
        'Valid system setup loss mein gaya — SL respect hua ya nahi, re-entry rules sahi the ya nahi, check karo.',
      tapori:
        'Valid system setup loss mein gaya bhai — SL sahi tha ya nahi, re-entry rules check kar.',
      marathi:
        'Valid system setup loss madhe gela — SL respect zala ka, re-entry rules bagha.',
    });
  }

  if (
    line ===
    'Discretionary win — price action did not fully approve this entry. Do not treat this as proof the filters are too strict.'
  ) {
    return pickLocalized(voice, {
      simple:
        'Discretionary win — chart ne entry fully approve nahi ki. Iska matlab filters loose mat karo.',
      tapori:
        'Discretionary win bhai — chart ne entry fully approve nahi ki. Filters loose mat samajh.',
      marathi:
        'Discretionary win — chart ne entry fully approve nahi keli. Filters loose nako kara.',
    });
  }

  if (line === 'Flat or scratch trade with weak alignment to the engine at entry.') {
    return pickLocalized(voice, {
      simple: 'Flat/scratch trade — entry pe engine se weak alignment thi.',
      tapori: 'Flat/scratch trade bhai — entry pe engine se weak alignment thi.',
      marathi: 'Flat/scratch trade — entry var engine sobat weak alignment hoti.',
    });
  }

  if (line.startsWith('At entry the engine showed NO-TRADE or decay veto')) {
    const suffix = line.includes(':') ? line.split(':').slice(1).join(':') : '.';
    return pickLocalized(voice, {
      simple: `Entry pe engine ne NO-TRADE ya decay veto dikhaya${suffix}`,
      tapori: `Entry pe engine ne NO-TRADE ya decay veto maara${suffix}`,
      marathi: `Entry var engine ne NO-TRADE ki decay veto dakhvila${suffix}`,
    });
  }

  const weakEntry = line.match(
    /^Entry direction matched \((.+)\) but confidence was only (\d+)% \(need (\d+)\+\)\.$/,
  );
  if (weakEntry) {
    const [, dir, conf, need] = weakEntry;
    return pickLocalized(voice, {
      simple: `Direction ${dir} match thi par confidence sirf ${conf}% thi (chahiye ${need}%+).`,
      tapori: `Direction ${dir} match thi par confidence sirf ${conf}% thi bhai (chahiye ${need}%+).`,
      marathi: `Direction ${dir} match hoti pan confidence fakt ${conf}% (lagte ${need}%+).`,
    });
  }

  const replayTp = line.match(
    /^Index replay suggests (.+) was reachable \(\+(.+)R on spot\) while option PnL was negative — check premium\/IV timing\.$/,
  );
  if (replayTp) {
    return pickLocalized(voice, {
      simple: `Index replay: ${replayTp[1]} reachable tha (+${replayTp[2]}R spot) par option PnL negative — premium/IV timing check karo.`,
      tapori: `Index replay bhai: ${replayTp[1]} reachable tha (+${replayTp[2]}R) par option PnL negative — premium/IV timing dekh.`,
      marathi: `Index replay: ${replayTp[1]} reachable hota (+${replayTp[2]}R) pan option PnL negative — premium/IV timing bagha.`,
    });
  }

  if (
    line ===
    'Spot would have hit the engine stop, but option premium still closed green — good options execution despite index noise.'
  ) {
    return pickLocalized(voice, {
      simple:
        'Spot engine stop tak ja sakta tha, par option green close — index noise ke bawajood options execution acchi thi.',
      tapori:
        'Spot engine stop tak ja sakta tha bhai, par option green close — index noise ke bawajood execution acchi thi.',
      marathi:
        'Spot engine stop la jau shakta hota, pan option green close — index noise asunahi execution changli hoti.',
    });
  }

  const continued = line.match(
    /^Spot continued ~(.+)R in your favor after exit — consider partials\/trailing instead of full early exit\.$/,
  );
  if (continued) {
    return pickLocalized(voice, {
      simple: `Exit ke baad spot ~${continued[1]}R aur tumhare favor mein gaya — full early exit ki jagah partial/trail socho.`,
      tapori: `Exit ke baad spot ~${continued[1]}R aur favor mein gaya bhai — partial/trail soch.`,
      marathi: `Exit nantar spot ~${continued[1]}R tumchya favor madhe gela — full early exit oobato partial/trail vichar kara.`,
    });
  }

  if (
    line ===
    'Spot reversed after your exit — exit timing protected you from giving back open profit.'
  ) {
    return pickLocalized(voice, {
      simple:
        'Exit ke baad spot ulta gaya — exit timing ne open profit wapas dene se bachaya.',
      tapori:
        'Exit ke baad spot ulta gaya bhai — exit timing ne profit wapas dene se bachaya.',
      marathi:
        'Exit nantar spot ulat gela — exit timing ne open profit parat dene pasun vachavla.',
    });
  }

  if (
    line ===
    'Entry looks chased: spot had already moved materially in the pre-trade window.'
  ) {
    return pickLocalized(voice, {
      simple:
        'Entry chased lag rahi hai — trade se pehle spot pehle se move ho chuka tha.',
      tapori:
        'Entry chased lag rahi hai bhai — trade se pehle spot pehle se move ho chuka tha.',
      marathi:
        'Entry chased diste — trade aadhi spot aadich move zala hota.',
    });
  }

  return line;
}