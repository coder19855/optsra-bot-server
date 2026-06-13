import { DecisionAction } from '../types/trade-decision';
import {
  SignalAlertTone,
  SignalChangeKind,
  SignalSnapshot,
  TpAlertKind,
  TpHoldAdvice,
} from '../types/telegram-notifications';
import { TelegramVoice } from '../types/telegram-voice';
import { RrLabel } from '../types/technical-analysis';

export function voiceDisplayName(voice: TelegramVoice): string {
  switch (voice) {
    case 'trader':
      return 'Trader (English)';
    case 'simple':
      return 'Simple (Hindi)';
    case 'tapori':
      return 'Tapori (Hinglish)';
    case 'marathi':
      return 'Marathi-English';
  }
}

export function translateExitReason(
  reason: string | null | undefined,
  voice: TelegramVoice,
): string | null {
  if (!reason || voice === 'trader') return reason ?? null;

  if (reason.includes('Setup cooled off')) {
    switch (voice) {
      case 'simple':
        return 'Setup thanda ho gaya — edge fade ho raha hai. Stop na lage tab tak hold karo; hard exit confirm hone ka wait karo.';
      case 'tapori':
        return 'Bhai setup thanda pad raha hai — edge fade chal raha hai. SL na lage tab tak hold kar; hard exit confirm ka wait kar.';
      case 'marathi':
        return 'Setup thanda hotoy — edge fade hotoy. Stop na lagla tar hold kar; hard exit confirm cha wait kar.';
    }
  }

  const stopMatch = reason.match(/Index stop breached \(spot ([\d,]+)\)/);
  if (stopMatch) {
    const spot = stopMatch[1];
    switch (voice) {
      case 'simple':
        return `Index stop toot gaya (spot ${spot}) — position band karo.`;
      case 'tapori':
        return `Bhai index SL toot gaya (spot ${spot}) — position kaat de!`;
      case 'marathi':
        return `Index stop laagla (spot ${spot}) — position book kar.`;
    }
  }

  const oppositeMatch = reason.match(/Opposite (CE-BUY|PE-BUY) confirmed — exit (CE-BUY|PE-BUY)/);
  if (oppositeMatch) {
    const [, newDir, held] = oppositeMatch;
    switch (voice) {
      case 'simple':
        return `Ulta signal confirm — ${newDir} aa gaya, ${held} band karo.`;
      case 'tapori':
        return `Bhai ulta signal confirm — ${newDir} aa gaya, ${held} kaat de!`;
      case 'marathi':
        return `Ulta signal confirm — ${newDir} aala, ${held} book kar.`;
    }
  }

  const decayMatch = reason.match(
    /Conviction (\d+)% below (\d+)% with chart veto — exit (CE-BUY|PE-BUY)/,
  );
  if (decayMatch) {
    const [, conv, floor, held] = decayMatch;
    switch (voice) {
      case 'simple':
        return `Conviction ${conv}% neeche ${floor}% — chart veto — ${held} band karo.`;
      case 'tapori':
        return `Bhai conviction ${conv}% neeche ${floor}% — chart ne mana kar diya — ${held} exit maar!`;
      case 'marathi':
        return `Conviction ${conv}% khali ${floor}% — chart veto — ${held} book kar.`;
    }
  }

  return reason;
}

export function signalHeadline(params: {
  voice: TelegramVoice;
  action: DecisionAction;
  flipped: boolean;
  alertTone?: SignalAlertTone;
  kinds?: SignalChangeKind[];
  exitReason?: string | null;
}): string {
  const { voice, action, flipped, alertTone, kinds, exitReason } = params;
  const localizedExit = translateExitReason(exitReason, voice);

  if (alertTone === 'hard_exit' || kinds?.includes('HARD_EXIT')) {
    const text =
      localizedExit ??
      (voice === 'simple'
        ? 'Position band karo — hard exit trigger'
        : voice === 'tapori'
          ? 'Bhai position kaat de — hard exit trigger!'
          : voice === 'marathi'
            ? 'Position book kar — hard exit trigger'
            : 'Exit position — hard exit trigger');
    return text;
  }

  if (alertTone === 'caution' || kinds?.includes('EDGE_FADE')) {
    const text =
      localizedExit ??
      (voice === 'simple'
        ? 'Edge fade ho raha hai — stop na lage tab tak hold karo'
        : voice === 'tapori'
          ? 'Edge fade chal raha hai bhai — SL na lage tab tak hold kar'
          : voice === 'marathi'
            ? 'Edge fade hotoy — stop na lagla tar hold kar'
            : 'Edge fading — hold unless stop hits');
    return text;
  }

  if (flipped) {
    switch (voice) {
      case 'simple':
        return 'Direction badal gaya';
      case 'tapori':
        return 'Bhai direction flip ho gaya!';
      case 'marathi':
        return 'Direction flip zala';
      default:
        return 'Direction changed';
    }
  }

  switch (action) {
    case 'CE-BUY':
      switch (voice) {
        case 'simple':
          return 'CALL lo — index upar ja sakta hai';
        case 'tapori':
          return 'Bhai CALL pakad — index upar ja sakta hai';
        case 'marathi':
          return 'CALL ghe — index var jau shakto';
        default:
          return 'BUY CALL · bet index goes UP';
      }
    case 'PE-BUY':
      switch (voice) {
        case 'simple':
          return 'PUT lo — index neeche ja sakta hai';
        case 'tapori':
          return 'Bhai PUT pakad — index neeche ja sakta hai';
        case 'marathi':
          return 'PUT ghe — index khali jau shakto';
        default:
          return 'BUY PUT · bet index goes DOWN';
      }
    case 'NEUTRAL':
      switch (voice) {
        case 'simple':
          return 'Koi clear direction nahi — sirf neutral strategies';
        case 'tapori':
          return 'Bhai abhi koi side nahi — neutral hi khel';
        case 'marathi':
          return 'Clear direction nahi — neutral strategies';
        default:
          return 'No direction · neutral strategies only';
      }
    default:
      switch (voice) {
        case 'simple':
          return 'Trade mat lo — bahar raho';
        case 'tapori':
          return 'Bhai abhi mat khel — side mein baith';
        case 'marathi':
          return 'Trade nako — baahir rah';
        default:
          return 'No trade · stay out';
      }
  }
}

export function signalActionLabel(
  action: DecisionAction,
  voice: TelegramVoice,
): string {
  switch (action) {
    case 'CE-BUY':
      switch (voice) {
        case 'simple':
          return 'Call (CE) khareedo';
        case 'tapori':
          return 'Call (CE) pakad';
        case 'marathi':
          return 'Call (CE) ghe';
        default:
          return 'Buy Call (CE)';
      }
    case 'PE-BUY':
      switch (voice) {
        case 'simple':
          return 'Put (PE) khareedo';
        case 'tapori':
          return 'Put (PE) pakad';
        case 'marathi':
          return 'Put (PE) ghe';
        default:
          return 'Buy Put (PE)';
      }
    case 'NEUTRAL':
      return voice === 'simple' || voice === 'tapori' ? 'Neutral' : 'Neutral';
    default:
      switch (voice) {
        case 'simple':
          return 'Koi trade nahi';
        case 'tapori':
          return 'No trade bhai';
        case 'marathi':
          return 'Trade nahi';
        default:
          return 'No trade';
      }
  }
}

export function signalChangeLine(params: {
  voice: TelegramVoice;
  previous: SignalSnapshot | null;
  current: SignalSnapshot;
  kinds: SignalChangeKind[];
  exitReason?: string | null;
  isFlip: boolean;
}): string | null {
  const { voice, previous, current, kinds, exitReason, isFlip } = params;
  if (!previous) return null;
  if (kinds.includes('EDGE_FADE')) return null;

  const localizedExit = translateExitReason(exitReason, voice);
  if (kinds.includes('HARD_EXIT') && localizedExit) {
    return `🛑 ${localizedExit}`;
  }

  const prevLabel = signalActionLabel(previous.action, voice);
  const currLabel = signalActionLabel(current.action, voice);

  if (isFlip || kinds.includes('ACTION') || kinds.includes('INITIAL')) {
    switch (voice) {
      case 'simple':
        return `🔄 Pehle ${prevLabel} → ab ${currLabel}`;
      case 'tapori':
        return `🔄 Pehle ${prevLabel} tha → ab ${currLabel}`;
      case 'marathi':
        return `🔄 Aadhi ${prevLabel} → ata ${currLabel}`;
      default:
        return `🔄 Was ${prevLabel} → now ${currLabel}`;
    }
  }

  return null;
}

export function signalReadyText(
  shouldConsiderTrade: boolean,
  voice: TelegramVoice,
): string {
  if (shouldConsiderTrade) {
    switch (voice) {
      case 'simple':
        return 'Enter kar sakte ho';
      case 'tapori':
        return 'Entry clear hai bhai';
      case 'marathi':
        return 'Entry karu shakto';
      default:
        return 'OK to enter';
    }
  }
  switch (voice) {
    case 'simple':
      return 'Thoda wait karo ya size kam karo';
    case 'tapori':
      return 'Ruk ja bhai ya chhota size le';
    case 'marathi':
      return 'Thoda wait kara ki size kami kara';
    default:
      return 'Wait or size down';
  }
}

export function signalStrikeTitle(action: DecisionAction, voice: TelegramVoice): string {
  if (action === 'CE-BUY') {
    switch (voice) {
      case 'simple':
        return '<b>YE CALL KHAREEDO</b>';
      case 'tapori':
        return '<b>YE CALL PAKAD BHAI</b>';
      case 'marathi':
        return '<b>HA CALL GHE</b>';
      default:
        return '<b>BUY THIS CALL</b>';
    }
  }
  if (action === 'PE-BUY') {
    switch (voice) {
      case 'simple':
        return '<b>YE PUT KHAREEDO</b>';
      case 'tapori':
        return '<b>YE PUT PAKAD BHAI</b>';
      case 'marathi':
        return '<b>HA PUT GHE</b>';
      default:
        return '<b>BUY THIS PUT</b>';
    }
  }
  return '<b>SUGGESTED STRIKE</b>';
}

export function signalPriceActionLine(params: {
  voice: TelegramVoice;
  paAction: string;
  confidence: number;
  brainAction: DecisionAction;
  chartVetoed: boolean;
  structuralAction?: string;
  vetoReason?: string;
  beforeDecay?: number | null;
}): string {
  const {
    voice,
    paAction,
    confidence,
    chartVetoed,
    structuralAction,
    beforeDecay,
  } = params;

  if (chartVetoed) {
    if (structuralAction === 'PE-BUY' || paAction === 'PE-BUY') {
      const was =
        beforeDecay != null && beforeDecay > 0
          ? voice === 'trader'
            ? ` (was ${beforeDecay}% before decay)`
            : voice === 'marathi'
              ? ` (${beforeDecay}% hota decay aadhi)`
              : ` (pehle ${beforeDecay}% tha decay se pehle)`
          : '';
      switch (voice) {
        case 'simple':
          return `📊 Chart: bearish structure mana — momentum decay${was}`;
        case 'tapori':
          return `📊 Chart ne bearish read ko veto maara — momentum decay${was}`;
        case 'marathi':
          return `📊 Chart ne bearish read la veto — momentum decay${was}`;
        default:
          return `📊 Price action: bearish structure vetoed${was} — momentum decay`;
      }
    }
    if (structuralAction === 'CE-BUY' || paAction === 'CE-BUY') {
      const was =
        beforeDecay != null && beforeDecay > 0
          ? voice === 'trader'
            ? ` (was ${beforeDecay}% before decay)`
            : voice === 'marathi'
              ? ` (${beforeDecay}% hota decay aadhi)`
              : ` (pehle ${beforeDecay}% tha decay se pehle)`
          : '';
      switch (voice) {
        case 'simple':
          return `📊 Chart: bullish structure mana — momentum decay${was}`;
        case 'tapori':
          return `📊 Chart ne bullish read ko veto maara — momentum decay${was}`;
        case 'marathi':
          return `📊 Chart ne bullish read la veto — momentum decay${was}`;
        default:
          return `📊 Price action: bullish structure vetoed${was} — momentum decay`;
      }
    }
    switch (voice) {
      case 'simple':
        return '📊 Chart ne trade mana — momentum decay';
      case 'tapori':
        return '📊 Chart bhai trade nahi de raha — momentum decay';
      case 'marathi':
        return '📊 Chart trade nako deto — momentum decay';
      default:
        return '📊 Price action: NO-TRADE · chart vetoed (momentum decay)';
    }
  }

  if (paAction === 'CE-BUY') {
    switch (voice) {
      case 'simple':
        return `📊 Chart: UP (CE) · ${confidence}%`;
      case 'tapori':
        return `📊 Chart bullish · CE · ${confidence}%`;
      case 'marathi':
        return `📊 Chart bullish · CE · ${confidence}%`;
      default:
        return `📊 Price action: CE-BUY (bullish) · ${confidence}%`;
    }
  }
  if (paAction === 'PE-BUY') {
    switch (voice) {
      case 'simple':
        return `📊 Chart: DOWN (PE) · ${confidence}%`;
      case 'tapori':
        return `📊 Chart bearish · PE · ${confidence}%`;
      case 'marathi':
        return `📊 Chart bearish · PE · ${confidence}%`;
      default:
        return `📊 Price action: PE-BUY (bearish) · ${confidence}%`;
    }
  }
  return `📊 ${paAction} · ${confidence}%`;
}

export function signalOptionRead(
  ofBias: string | undefined,
  action: DecisionAction,
  voice: TelegramVoice,
): string | null {
  if (!ofBias) return null;
  const lower = ofBias.toLowerCase();
  const optionsUp = lower.includes('bullish');
  const optionsDown = lower.includes('bearish');
  if (!optionsUp && !optionsDown) return null;

  if (action === 'CE-BUY' && optionsDown) {
    switch (voice) {
      case 'simple':
        return '⚠️ Options DOWN bol rahe — Call se match nahi';
      case 'tapori':
        return '⚠️ Options bhai DOWN bol rahe — Call se match nahi';
      case 'marathi':
        return '⚠️ Options DOWN mhantat — Call match nahi';
      default:
        return '⚠️ Options say DOWN — does not match this Call idea';
    }
  }
  if (action === 'PE-BUY' && optionsUp) {
    switch (voice) {
      case 'simple':
        return '⚠️ Options UP bol rahe — Put se match nahi';
      case 'tapori':
        return '⚠️ Options bhai UP bol rahe — Put se match nahi';
      case 'marathi':
        return '⚠️ Options UP mhantat — Put match nahi';
      default:
        return '⚠️ Options say UP — does not match this Put idea';
    }
  }
  if (optionsUp) {
    switch (voice) {
      case 'simple':
        return '🌊 Options UP agree';
      case 'tapori':
        return '🌊 Options bhi UP bol rahe';
      case 'marathi':
        return '🌊 Options pan UP';
      default:
        return '🌊 Options agree: UP';
    }
  }
  if (optionsDown) {
    switch (voice) {
      case 'simple':
        return '🌊 Options DOWN agree';
      case 'tapori':
        return '🌊 Options bhi DOWN bol rahe';
      case 'marathi':
        return '🌊 Options pan DOWN';
      default:
        return '🌊 Options agree: DOWN';
    }
  }
  return null;
}

export function signalConvictionLine(
  conviction: number,
  voice: TelegramVoice,
): string {
  switch (voice) {
    case 'simple':
      return `${conviction}% conviction (engine score)`;
    case 'tapori':
      return `${conviction}% conviction`;
    case 'marathi':
      return `${conviction}% conviction`;
    default:
      return `${conviction}% conviction`;
  }
}

export function tpKindHeadline(kinds: TpAlertKind[], voice: TelegramVoice): string {
  if (kinds.includes('SIGNAL_CONFLICT')) {
    switch (voice) {
      case 'simple':
        return '⚔️ Position aur signal match nahi';
      case 'tapori':
        return '⚔️ Bhai position aur signal lad rahe hain';
      case 'marathi':
        return '⚔️ Position ani signal match nahi';
      default:
        return '⚔️ Position vs engine';
    }
  }
  if (kinds.includes('REACHED')) {
    switch (voice) {
      case 'simple':
        return '🎉 Target aa gaya';
      case 'tapori':
        return '🎉 Bhai target hit ho gaya!';
      case 'marathi':
        return '🎉 Target laagla';
      default:
        return '🎉 Target hit';
    }
  }
  if (kinds.includes('APPROACHING')) {
    switch (voice) {
      case 'simple':
        return '👀 Target paas aa raha hai';
      case 'tapori':
        return '👀 Bhai target ke kareeb';
      case 'marathi':
        return '👀 Target javal yetoy';
      default:
        return '👀 Target near';
    }
  }
  switch (voice) {
    case 'simple':
      return '🧭 Hold check';
    case 'tapori':
      return '🧭 Bhai ab kya karein?';
    case 'marathi':
      return '🧭 Ata kay karaycha?';
    default:
      return '🧭 Hold check';
  }
}

export function tpCoachTitle(voice: TelegramVoice): string {
  switch (voice) {
    case 'simple':
      return '<b>🧭 Coach</b>';
    case 'tapori':
      return '<b>🧭 Bhai coach bol raha</b>';
    case 'marathi':
      return '<b>🧭 Coach sangto</b>';
    default:
      return '<b>🧭 Coach</b>';
  }
}

export function tpEngineLine(params: {
  voice: TelegramVoice;
  signalAction: string;
  conviction: number;
  bias: string;
}): string {
  const { voice, signalAction, conviction, bias } = params;
  switch (voice) {
    case 'simple':
      return `Signal: ${signalAction} ${conviction}% · ${bias}`;
    case 'tapori':
      return `Engine bhai bol raha: ${signalAction} ${conviction}% · ${bias}`;
    case 'marathi':
      return `Engine: ${signalAction} ${conviction}% · ${bias}`;
    default:
      return `Engine: ${signalAction} ${conviction}% · ${bias}`;
  }
}

export function tpHoldHeadline(params: {
  voice: TelegramVoice;
  original: string;
  holdAdvice: TpHoldAdvice;
  alertKind: TpAlertKind;
  highestHitRr?: RrLabel | null;
  nextTpRr?: RrLabel | null;
}): string {
  const { voice, original, holdAdvice, alertKind, highestHitRr, nextTpRr } =
    params;
  if (voice === 'trader') return original;

  if (alertKind === 'SIGNAL_CONFLICT' || original.includes('no longer supports')) {
    switch (voice) {
      case 'simple':
        return 'Signal ab tumhari position support nahi karta — book ya size cut karo.';
      case 'tapori':
        return 'Bhai signal ab teri position ko support nahi kar raha — book kar ya size kaat.';
      case 'marathi':
        return 'Signal ata position support nahi karto — book kar ki size kami kar.';
    }
  }

  if (highestHitRr === '1:3') {
    switch (voice) {
      case 'simple':
        return 'Poora 1:3 target aa gaya — baaki book karo, profit bachao.';
      case 'tapori':
        return 'Bhai full 1:3 ho gaya — baaki book kar, profit safe kar!';
      case 'marathi':
        return 'Full 1:3 laagla — baaki book kar, profit vachav.';
    }
  }

  if (highestHitRr === '1:2' || original.includes('1:2 target hit')) {
    if (holdAdvice === 'trail') {
      switch (voice) {
        case 'simple':
          return '1:2 hit — trail stop rakho, momentum sahi hai to 1:3 ke liye hold.';
        case 'tapori':
          return '1:2 pakka — trail maar, momentum clean hai to 1:3 ke liye hold kar bhai!';
        case 'marathi':
          return '1:2 laagla — trail stop thev, momentum clean asel tar 1:3 sathi hold kar.';
      }
    }
    if (original.includes('only runners')) {
      switch (voice) {
        case 'simple':
          return '1:2 hit — partial book karo; baaki sirf tight trail wale runners.';
        case 'tapori':
          return '1:2 ho gaya bhai — partial book kar; baaki sirf tight trail runners.';
        case 'marathi':
          return '1:2 laagla — partial book kar; baaki fakt tight trail runners.';
      }
    }
    switch (voice) {
      case 'simple':
        return '1:2 hit — partial book karo, tight trail se runner rakho.';
      case 'tapori':
        return '1:2 ho gaya bhai — partial book kar, baaki tight trail pe chhod.';
      case 'marathi':
        return '1:2 laagla — partial book kar, baaki tight trail var thev.';
    }
  }

  if (highestHitRr === '1:1' || original.startsWith('1:1 target')) {
    if (holdAdvice === 'exit') {
      switch (voice) {
        case 'simple':
          return '1:1 aa gaya lekin conviction weak — zyada tar book karo.';
        case 'tapori':
          return '1:1 to aa gaya bhai par conviction weak — zyada hissa book kar.';
        case 'marathi':
          return '1:1 laagla pan conviction weak — jast book kar.';
      }
    }
    switch (voice) {
      case 'simple':
        return '1:1 hit — thoda book karo, baaki 1:2 ke liye trail.';
      case 'tapori':
        return '1:1 pakka bhai — thoda book kar, baaki 1:2 ke trail pe chhod.';
      case 'marathi':
        return '1:1 laagla — thoda book kar, baaki 1:2 sathi trail.';
    }
  }

  if (alertKind === 'APPROACHING' && nextTpRr) {
    if (holdAdvice === 'hold') {
      switch (voice) {
        case 'simple':
          return `${nextTpRr} paas aa rahe ho — reject ho to trail tight, accept ho to hold.`;
        case 'tapori':
          return `Bhai ${nextTpRr} ke kareeb — reject hua to trail tight, accept hua to hold!`;
        case 'marathi':
          return `${nextTpRr} javal yetoy — reject zala tar trail tight, accept zala tar hold.`;
      }
    }
    switch (voice) {
      case 'simple':
        return `${nextTpRr} ke paas — level pe book karne ka lean karo.`;
      case 'tapori':
        return `${nextTpRr} ke paas bhai — level pe book karne ka mood bana.`;
      case 'marathi':
        return `${nextTpRr} javal — level var book karaycha vichar kar.`;
    }
  }

  if (original.includes('no TP trigger')) {
    switch (voice) {
      case 'simple':
        return 'Position chal rahi hai — abhi TP trigger nahi.';
      case 'tapori':
        return 'Trade chal rahi hai bhai — abhi TP trigger nahi hua.';
      case 'marathi':
        return 'Position chalu aahe — ata TP trigger nahi.';
    }
  }

  return original;
}

export function voicePreviewSamples(voice: TelegramVoice): string[] {
  switch (voice) {
    case 'simple':
      return [
        '📈 CALL lo — index upar ja sakta hai',
        '⚠️ Edge fade — stop na lage tab tak hold karo',
        '🎉 1:2 target — thoda book karo, baaki trail',
      ];
    case 'tapori':
      return [
        '📉 Bhai PUT pakad — index neeche ja sakta hai',
        '⚠️ Edge fade — SL na lage tab tak hold kar',
        '🎉 1:2 hit — partial book kar bhai',
      ];
    case 'marathi':
      return [
        '📈 CALL ghe — index var jau shakto',
        '⚠️ Edge fade — stop na lagla tar hold kar',
        '🎉 1:2 laagla — thoda book kar',
      ];
    default:
      return [
        '📈 BUY CALL · bet index goes UP',
        '⚠️ Edge fading — hold unless stop hits',
        '🎉 Target hit — book partial at 1:2',
      ];
  }
}

export function playbookSectionTitle(voice: TelegramVoice): string {
  switch (voice) {
    case 'simple':
      return 'Playbook';
    case 'tapori':
      return 'Playbook';
    case 'marathi':
      return 'Playbook';
    default:
      return 'Playbook';
  }
}

export function playbookSectionNote(voice: TelegramVoice): string {
  switch (voice) {
    case 'simple':
      return 'Doosre option structures (spreads, condors) — upar wali single strike nahi.';
    case 'tapori':
      return 'Aur bhi structures (spreads, condors) — upar wali ek strike alag hai.';
    case 'marathi':
      return 'Itar option structures (spreads, condors) — varchi single strike nahi.';
    default:
      return 'Other option structures (spreads, condors, etc.) — not the single strike above.';
  }
}

export function walletSectionTitle(voice: TelegramVoice): string {
  switch (voice) {
    case 'simple':
      return 'Wallet';
    case 'tapori':
      return 'Wallet';
    case 'marathi':
      return 'Wallet';
    default:
      return 'Wallet';
  }
}

export function adaptiveConvictionLine(params: {
  voice: TelegramVoice;
  recommendedEnterThreshold: number;
  overallWinRate: number;
  sampleSize: number;
  conviction: number;
}): string {
  const meets = params.conviction >= params.recommendedEnterThreshold;
  const icon = meets ? '✅' : '⚠️';
  switch (params.voice) {
    case 'simple':
      return `${icon} Tumhara enter bar: ${params.recommendedEnterThreshold}% (${params.overallWinRate}% jeet ${params.sampleSize} alerts pe)`;
    case 'tapori':
      return `${icon} Tera enter bar: ${params.recommendedEnterThreshold}% (${params.overallWinRate}% win ${params.sampleSize} alerts pe)`;
    case 'marathi':
      return `${icon} Tumcha enter bar: ${params.recommendedEnterThreshold}% (${params.overallWinRate}% wins ${params.sampleSize} alerts)`;
    default:
      return `${icon} Your enter bar: ${params.recommendedEnterThreshold}% (${params.overallWinRate}% wins on ${params.sampleSize} past alerts)`;
  }
}

export function vetoSectionTitle(voice: TelegramVoice): string {
  switch (voice) {
    case 'simple':
      return 'Entry mana';
      case 'tapori':
        return 'Entry block';
    case 'marathi':
      return 'Entry block';
    default:
      return 'Entry veto';
  }
}

export function vetoSectionFooter(voice: TelegramVoice): string {
  switch (voice) {
    case 'simple':
      return '→ Blockers clear hone tak bahar raho';
    case 'tapori':
      return '→ Jab tak blockers clear na hon, side mein raho';
    case 'marathi':
      return '→ Blockers clear hotaeparyant baahir raha';
    default:
      return '→ Stay out until blockers clear';
  }
}

export function translateVetoBlocker(line: string, voice: TelegramVoice): string {
  if (voice === 'trader') return line;

  const belowBar = line.match(
    /Conviction (\d+)% below (\d+)% enter bar/,
  );
  if (belowBar) {
    const [, conv, bar] = belowBar;
    switch (voice) {
      case 'simple':
        return `Conviction ${conv}% enter bar ${bar}% se neeche hai`;
      case 'tapori':
        return `Conviction ${conv}% enter bar ${bar}% se neeche hai`;
      case 'marathi':
        return `Conviction ${conv}% enter bar ${bar}% khali aahe`;
    }
  }

  if (line.includes('Momentum decay vetoed bearish chart')) {
    const was = line.includes('was') ? line.split('Momentum decay vetoed bearish chart')[1] : '';
    switch (voice) {
      case 'simple':
        return `Momentum decay ne bearish chart ko mana kiya${was}`;
      case 'tapori':
        return `Momentum decay ne bearish chart veto maara${was}`;
      case 'marathi':
        return `Momentum decay ne bearish chart la veto${was}`;
    }
  }

  if (line.includes('Momentum decay vetoed bullish chart')) {
    const was = line.includes('was') ? line.split('Momentum decay vetoed bullish chart')[1] : '';
    switch (voice) {
      case 'simple':
        return `Momentum decay ne bullish chart ko mana kiya${was}`;
      case 'tapori':
        return `Momentum decay ne bullish chart veto maara${was}`;
      case 'marathi':
        return `Momentum decay ne bullish chart la veto${was}`;
    }
  }

  if (line === 'Chart vetoed — momentum decay') {
    switch (voice) {
      case 'simple':
        return 'Chart ne mana — momentum decay';
      case 'tapori':
        return 'Chart ne veto maara — momentum decay';
      case 'marathi':
        return 'Chart ne veto — momentum decay';
    }
  }

  return line;
}

export function translateStructureHeadline(line: string, voice: TelegramVoice): string {
  if (voice === 'trader') return line;

  if (line.includes('Market bearish — all timeframes downtrend')) {
    switch (voice) {
      case 'simple':
        return line.replace('Market bearish — all timeframes downtrend', 'Market bearish — saare timeframes downtrend');
      case 'tapori':
        return line.replace('Market bearish — all timeframes downtrend', 'Market bearish bhai — saare TF downtrend');
      case 'marathi':
        return line.replace('Market bearish — all timeframes downtrend', 'Market bearish — sarva timeframes downtrend');
    }
  }
  if (line.includes('Market bullish — all timeframes uptrend')) {
    switch (voice) {
      case 'simple':
        return line.replace('Market bullish — all timeframes uptrend', 'Market bullish — saare timeframes uptrend');
      case 'tapori':
        return line.replace('Market bullish — all timeframes uptrend', 'Market bullish bhai — saare TF uptrend');
      case 'marathi':
        return line.replace('Market bullish — all timeframes uptrend', 'Market bullish — sarva timeframes uptrend');
    }
  }
  if (line.includes('entry not cleared')) {
    if (line.includes('Bearish')) {
      switch (voice) {
        case 'simple':
          return '📉 Bearish setup — entry clear nahi hui';
        case 'tapori':
          return '📉 Bearish setup bhai — entry clear nahi';
        case 'marathi':
          return '📉 Bearish context — entry clear nahi';
      }
    }
    if (line.includes('Bullish')) {
      switch (voice) {
        case 'simple':
          return '📈 Bullish setup — entry clear nahi hui';
        case 'tapori':
          return '📈 Bullish setup bhai — entry clear nahi';
        case 'marathi':
          return '📈 Bullish context — entry clear nahi';
      }
    }
  }
  if (line === '📉 Bearish structure — PE setup was on the table') {
    switch (voice) {
      case 'simple':
        return '📉 Bearish structure — PE setup table pe tha';
      case 'tapori':
        return '📉 Bearish structure — PE setup table pe tha';
      case 'marathi':
        return '📉 Bearish structure — PE setup table var hota';
    }
  }
  if (line === '📈 Bullish structure — CE setup was on the table') {
    switch (voice) {
      case 'simple':
        return '📈 Bullish structure — CE setup table pe tha';
      case 'tapori':
        return '📈 Bullish structure — CE setup table pe tha';
      case 'marathi':
        return '📈 Bullish structure — CE setup table var hota';
    }
  }

  return line;
}

export function translateSidelinesLine(line: string, voice: TelegramVoice): string {
  if (voice === 'trader') return line;
  if (line.includes('Bearish context — conviction') && line.includes('below')) {
    return line
      .replace('Bearish context — conviction', voice === 'marathi'
        ? 'Bearish context — conviction'
        : 'Bearish setup — conviction')
      .replace('below', voice === 'marathi' ? 'khali' : 'neeche');
  }
  if (line.includes('Bullish context — conviction') && line.includes('below')) {
    return line
      .replace('Bullish context — conviction', voice === 'marathi'
        ? 'Bullish context — conviction'
        : 'Bullish setup — conviction')
      .replace('below', voice === 'marathi' ? 'khali' : 'neeche');
  }
  if (line.includes('no entry yet')) {
    return line
      .replace('Bearish context — no entry yet', voice === 'simple'
        ? 'Bearish setup — abhi entry nahi'
        : voice === 'tapori'
          ? 'Bearish setup bhai — abhi entry nahi'
          : 'Bearish context — entry nahi')
      .replace('Bullish context — no entry yet', voice === 'simple'
        ? 'Bullish setup — abhi entry nahi'
        : voice === 'tapori'
          ? 'Bullish setup bhai — abhi entry nahi'
          : 'Bullish context — entry nahi')
      .replace('too weak', voice === 'marathi' ? 'khup weak' : 'bahut weak')
      .replace('need ≥', voice === 'marathi' ? 'lagte ' : 'chahiye ≥');
  }
  if (line.includes('No clear edge')) {
    switch (voice) {
      case 'simple':
        return line
          .replace('No clear edge', 'Clear edge nahi')
          .replace('need ≥', 'chahiye ≥');
      case 'tapori':
        return line
          .replace('No clear edge', 'Clear edge nahi bhai')
          .replace('need ≥', 'chahiye ≥');
      case 'marathi':
        return line
          .replace('No clear edge', 'Clear edge nahi')
          .replace('need ≥', 'lagte ');
    }
  }
  return line;
}

export function translateTimeframeLine(line: string, voice: TelegramVoice): string {
  if (voice === 'trader') return line;
  return line
    .replace('stack aligned — blocked (conviction & chart)', voice === 'simple'
      ? 'sab TF align — par conviction aur chart ne block kiya'
      : voice === 'tapori'
        ? 'TF align hai — par conviction/chart ne roka'
        : 'sarva TF align — pan conviction/chart ne block kele')
    .replace('stack aligned — conviction below enter bar', voice === 'marathi'
      ? 'stack align — conviction enter bar khali'
      : 'stack align — conviction enter bar se neeche')
    .replace('stack aligned — chart veto active', voice === 'marathi'
      ? 'stack align — chart veto active'
      : 'stack align — chart veto chal raha')
    .replace('stack aligned', voice === 'marathi' ? 'stack align' : 'stack align')
    .replace('mixed structure — waiting for trigger', voice === 'marathi'
      ? 'mixed structure — trigger cha wait'
      : 'mixed structure — trigger ka wait')
    .replace('waiting for trigger', voice === 'marathi' ? 'trigger cha wait' : 'trigger ka wait');
}

export function translateTpHoldReason(line: string, voice: TelegramVoice): string {
  if (voice === 'trader') return line;

  if (line.includes('Engine direction has diverged')) {
    switch (voice) {
      case 'simple':
        return 'Engine direction ab tumhari open position se alag hai.';
      case 'tapori':
        return 'Engine direction ab teri open position se alag ho gaya.';
      case 'marathi':
        return 'Engine direction ata open position peksha vegla aahe.';
    }
  }
  if (line.includes('Engine spot target at 1:3 is hit')) {
    switch (voice) {
      case 'simple':
        return 'Engine ka 1:3 spot target hit — alag plan ho tab hi trail karo.';
      case 'tapori':
        return 'Engine ka 1:3 spot hit — alag plan ho tab hi trail kar bhai.';
      case 'marathi':
        return 'Engine cha 1:3 spot target laagla — vegla plan asel tarach trail kara.';
    }
  }
  if (line.includes('Do not hold a CE/PE position against')) {
    switch (voice) {
      case 'simple':
        return 'Flat/ulta signal ke against CE/PE mat pakdo.';
      case 'tapori':
        return 'Flat/ulta signal ke against position mat pakad.';
      case 'marathi':
        return 'Flat/ulta signal against CE/PE hold nako kara.';
    }
  }

  const decay = line.match(/Momentum decay is elevated \((\d+)%\) — edge is fading/);
  if (decay) {
    switch (voice) {
      case 'simple':
        return `Momentum decay badha hua (${decay[1]}%) — edge fade ho raha hai.`;
      case 'tapori':
        return `Momentum decay high (${decay[1]}%) — edge fade ho raha hai.`;
      case 'marathi':
        return `Momentum decay jast (${decay[1]}%) — edge fade hotoy.`;
    }
  }

  const convBelow = line.match(
    /Conviction \((\d+)%\) is below the (\w+) entry bar \((\d+)%\)/,
  );
  if (convBelow) {
    const [, conv, style, bar] = convBelow;
    switch (voice) {
      case 'simple':
        return `Conviction ${conv}% ${style} entry bar ${bar}% se neeche hai.`;
      case 'tapori':
        return `Conviction ${conv}% ${style} entry bar ${bar}% se neeche.`;
      case 'marathi':
        return `Conviction ${conv}% ${style} entry bar ${bar}% khali aahe.`;
    }
  }

  const convStrong = line.match(/Conviction still strong \((\d+)% ≥ (\d+)%\)/);
  if (convStrong) {
    switch (voice) {
      case 'simple':
        return `Conviction abhi bhi strong hai (${convStrong[1]}% ≥ ${convStrong[2]}%).`;
      case 'tapori':
        return `Conviction abhi bhi strong (${convStrong[1]}% ≥ ${convStrong[2]}%).`;
      case 'marathi':
        return `Conviction ajun strong (${convStrong[1]}% ≥ ${convStrong[2]}%).`;
    }
  }

  if (line.includes('Move stop toward breakeven')) {
    switch (voice) {
      case 'simple':
        return 'Stop breakeven+ le jao, chhota size 1:3 ke liye rakho.';
      case 'tapori':
        return 'Stop breakeven+ shift kar, chhota runner 1:3 ke liye.';
      case 'marathi':
        return 'Stop breakeven+ thev, lahan size 1:3 sathi thev.';
    }
  }

  if (line.includes('Take meaningful profit at 1:2')) {
    switch (voice) {
      case 'simple':
        return '1:2 pe achha profit book karo; 1:3 ke liye conviction/momentum weak hai.';
      case 'tapori':
        return '1:2 pe solid book kar; 1:3 ke liye momentum weak hai.';
      case 'marathi':
        return '1:2 var profit book kara; 1:3 sathi momentum weak aahe.';
    }
  }

  if (line.includes('First target achieved but follow-through')) {
    switch (voice) {
      case 'simple':
        return 'Pehla target hit lekin follow-through weak — 1:2 assume mat karo.';
      case 'tapori':
        return 'Pehla target aa gaya par follow-through weak — 1:2 assume mat kar.';
      case 'marathi':
        return 'Pahila target laagla pan follow-through weak — 1:2 assume nako kara.';
    }
  }
  if (line.includes('First target achieved')) {
    switch (voice) {
      case 'simple':
        return 'Pehla target hit — 50% book + breakeven stop common playbook hai.';
      case 'tapori':
        return 'Pehla target aa gaya — 50% book + breakeven stop standard play hai.';
      case 'marathi':
        return 'Pahila target laagla — 50% book + breakeven stop common play.';
    }
  }
  if (line.includes('Consider taking profit into the level')) {
    switch (voice) {
      case 'simple':
        return 'Level pe profit book karne ka lean karo — extension ki umeed mat rakho.';
      case 'tapori':
        return 'Level pe book karne ka mood bana — extension ki umeed mat rakh.';
      case 'marathi':
        return 'Level var profit book karaycha vichar kara — extension chi aasha nako thevu.';
    }
  }
  if (line.includes('If level rejects, tighten stop')) {
    switch (voice) {
      case 'simple':
        return 'Level reject ho to stop tight karo; volume ke saath accept ho to next R ke liye trail.';
      case 'tapori':
        return 'Level reject hua to trail tight; volume ke saath accept hua to next R ke liye hold.';
      case 'marathi':
        return 'Level reject zala tar stop tight kara; volume sobat accept zala tar next R sathi trail.';
    }
  }

  if (line.includes('Spot is within reach of engine')) {
    const m = line.match(/Spot is within reach of engine ([\d:]+) \(([\d.]+)R now\)/);
    if (m) {
      switch (voice) {
        case 'simple':
          return `Spot engine ${m[1]} ke paas hai (${m[2]}R abhi).`;
        case 'tapori':
          return `Spot engine ${m[1]} ke paas hai (${m[2]}R).`;
        case 'marathi':
          return `Spot engine ${m[1]} javal aahe (${m[2]}R ata).`;
      }
    }
  }

  if (line.includes('Near') && line.includes('but conviction is only')) {
    const m = line.match(/Near ([\d:]+) but conviction is only (\d+)%/);
    if (m) {
      switch (voice) {
        case 'simple':
          return `${m[1]} ke paas ho lekin conviction sirf ${m[2]}% hai.`;
        case 'tapori':
          return `${m[1]} ke paas hai par conviction sirf ${m[2]}%.`;
        case 'marathi':
          return `${m[1]} javal aahe pan conviction fakt ${m[2]}%.`;
      }
    }
  }

  return line;
}