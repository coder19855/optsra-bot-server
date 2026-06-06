import {
  COACH_CHASE_MOVE_PERCENT,
  COACH_CLEAN_ENTRY,
  COACH_EARLY_EXIT_MISS_R,
  COACH_STYLE_ENTER_THRESHOLD,
} from '../constants/trading-coach';
import {
  CoachAnalysis,
  CoachEntryQuality,
  CoachExitQuality,
  CoachReplay,
  CoachVerdict,
  RoundTripTrade,
} from '../types/trading-coach';
import { TradingStyle } from '../types/trading-style';

function isCleanEntry(
  replay: CoachReplay,
  trade: RoundTripTrade,
): boolean {
  const atEntry = replay.atEntry;
  if (!atEntry) return false;
  if (atEntry.vetoedByDecay) return false;
  if (atEntry.signal.action !== trade.direction) return false;
  if (atEntry.signal.confidence < COACH_CLEAN_ENTRY.MIN_CONFIDENCE) return false;
  return COACH_CLEAN_ENTRY.STRENGTHS.includes(
    atEntry.signal.strength as 'MEDIUM' | 'HIGH',
  );
}

function classifyEntryQuality(replay: CoachReplay, trade: RoundTripTrade): CoachEntryQuality {
  const atEntry = replay.atEntry;
  if (!atEntry) return 'no_signal';
  if (atEntry.signal.action === 'NO-TRADE' || atEntry.vetoedByDecay) {
    return 'vetoed';
  }
  if (isCleanEntry(replay, trade)) return 'clean';
  if (atEntry.signal.action === trade.direction) return 'weak';
  return 'vetoed';
}

function classifyExitQuality(
  trade: RoundTripTrade,
  replay: CoachReplay,
): CoachExitQuality {
  if (!replay.excursion || !replay.postExit) return 'unknown';

  if (trade.pnlInr > 0 && replay.postExit.continuedInFavor) {
    const missed = replay.postExit.spotMoveR ?? 0;
    if (missed >= COACH_EARLY_EXIT_MISS_R) return 'early';
    return 'optimal';
  }

  if (trade.pnlInr > 0 && replay.postExit.reversedAfterExit) {
    return 'optimal';
  }

  if (trade.pnlInr <= 0 && (replay.excursion.mfeR ?? 0) >= 1) {
    return 'late';
  }

  if (trade.pnlInr <= 0) return 'acceptable';
  return 'acceptable';
}

function wasChasedEntry(replay: CoachReplay): boolean {
  const firstPre = replay.preTrade[replay.preTrade.length - 1];
  const atEntry = replay.atEntry;
  if (!firstPre || !atEntry || firstPre.spot <= 0) return false;

  const movePct = Math.abs(
    ((atEntry.spot - firstPre.spot) / firstPre.spot) * 100,
  );
  return movePct >= COACH_CHASE_MOVE_PERCENT;
}

export function analyzeTradeVerdict(
  trade: RoundTripTrade,
  replay: CoachReplay,
  tradingStyle: TradingStyle,
): CoachAnalysis {
  const entryQuality = classifyEntryQuality(replay, trade);
  const exitQuality = classifyExitQuality(trade, replay);
  const atEntry = replay.atEntry;
  const enterThreshold = COACH_STYLE_ENTER_THRESHOLD[tradingStyle];

  const directionMatch = atEntry?.signal.action === trade.direction;
  const convictionOk =
    (atEntry?.signal.confidence ?? 0) >= enterThreshold &&
    !atEntry?.vetoedByDecay;

  const systemApproved =
    directionMatch &&
    convictionOk &&
    entryQuality !== 'vetoed' &&
    atEntry?.signal.action !== 'NO-TRADE';

  const tags: string[] = [];
  const coaching: string[] = [];

  if (systemApproved) tags.push('system_approved');
  else tags.push('discretionary');

  if (entryQuality === 'clean') tags.push('clean_entry');
  if (entryQuality === 'weak') tags.push('weak_entry');
  if (entryQuality === 'vetoed') tags.push('vetoed_entry');
  if (wasChasedEntry(replay)) tags.push('chased_entry');

  if (exitQuality === 'early') tags.push('early_exit');
  if (exitQuality === 'late') tags.push('late_exit');
  if (exitQuality === 'optimal') tags.push('good_exit');

  if (trade.pnlInr > 0) tags.push('winner');
  else if (trade.pnlInr < 0) tags.push('loser');

  let verdict: CoachVerdict;

  if (!systemApproved && trade.pnlInr < 0) {
    verdict = 'ugly';
    coaching.push(
      'You took a losing trade without a system-approved setup at entry. This is the main discipline leak to fix.',
    );
  } else if (systemApproved && trade.pnlInr > 0) {
    verdict = 'good';
    coaching.push(
      'System-approved setup that finished green. This is the process you want to repeat.',
    );
  } else if (systemApproved && trade.pnlInr <= 0) {
    verdict = 'bad';
    coaching.push(
      'Valid system setup that lost. Review whether SL was honored and whether re-entry rules were respected.',
    );
  } else if (!systemApproved && trade.pnlInr > 0) {
    verdict = 'good';
    tags.push('lucky_override');
    coaching.push(
      'Discretionary win — price action did not fully approve this entry. Do not treat this as proof the filters are too strict.',
    );
  } else {
    verdict = 'bad';
    coaching.push('Flat or scratch trade with weak alignment to the engine at entry.');
  }

  if (entryQuality === 'vetoed') {
    coaching.push(
      `At entry the engine showed NO-TRADE or decay veto${atEntry?.signal.vetoReason ? `: ${atEntry.signal.vetoReason}` : '.'}`,
    );
  } else if (entryQuality === 'weak') {
    coaching.push(
      `Entry direction matched (${trade.direction}) but confidence was only ${atEntry?.signal.confidence ?? 0}% (need ${enterThreshold}+).`,
    );
  }

  if (replay.expectedOutcome && replay.excursion) {
    const expected = replay.expectedOutcome;
    if (expected.status === 'TAKE_PROFIT' && trade.pnlInr < 0) {
      coaching.push(
        `Index replay suggests ${expected.hitLevel} was reachable (+${expected.pnlR}R on spot) while option PnL was negative — check premium/IV timing.`,
      );
    }
    if (expected.status === 'STOP_LOSS' && trade.pnlInr > 0) {
      coaching.push(
        'Spot would have hit the engine stop, but option premium still closed green — good options execution despite index noise.',
      );
    }
  }

  if (replay.postExit?.continuedInFavor && (replay.postExit.spotMoveR ?? 0) >= COACH_EARLY_EXIT_MISS_R) {
    coaching.push(
      `Spot continued ~${replay.postExit.spotMoveR}R in your favor after exit — consider partials/trailing instead of full early exit.`,
    );
  }

  if (replay.postExit?.reversedAfterExit) {
    coaching.push(
      'Spot reversed after your exit — exit timing protected you from giving back open profit.',
    );
  }

  if (wasChasedEntry(replay)) {
    coaching.push(
      'Entry looks chased: spot had already moved materially in the pre-trade window.',
    );
  }

  return {
    systemApproved,
    entryQuality,
    exitQuality,
    verdict,
    tags,
    coaching,
  };
}