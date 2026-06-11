import {
  GreeksStrikeInsight,
  GreeksStrikeProfile,
} from '../types/greeks-strike-insight';
import {
  RecommendedStrategyAlert,
  SignalChangeKind,
  SignalSnapshot,
  TelegramPositionSizing,
  TradeDecisionAlertPayload,
} from '../types/telegram-notifications';
import { DecisionAction, TradeBias } from '../types/trade-decision';
import { joinTelegramLines, joinTelegramSections } from './message-layout';
import {
  formatEnginePickCallout,
  formatGreeksSectionHeader,
  gammaRowPrefix,
} from './strike-callouts';
import {
  formatScenarioBanner,
  formatSectionHeader,
  scenarioForSignalFlip,
  scenarioForTradeReady,
  wrapScenarioCallout,
} from './telegram-palette';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function shortSymbol(symbol: string): string {
  const part = symbol.split(':')[1] || symbol;
  return part.replace('-INDEX', '');
}

function isSignalFlip(
  previous: SignalSnapshot | null,
  current: SignalSnapshot,
): boolean {
  if (!previous) return false;
  return (
    (previous.action === 'CE-BUY' && current.action === 'PE-BUY') ||
    (previous.action === 'PE-BUY' && current.action === 'CE-BUY')
  );
}

function tradeHeadline(action: DecisionAction, flipped: boolean): string {
  if (flipped) {
    return formatScenarioBanner(
      scenarioForSignalFlip(),
      'Direction changed',
    );
  }
  switch (action) {
    case 'CE-BUY':
      return formatScenarioBanner('bullish', 'BUY CALL · bet index goes UP');
    case 'PE-BUY':
      return formatScenarioBanner('bearish', 'BUY PUT · bet index goes DOWN');
    case 'NEUTRAL':
      return formatScenarioBanner('neutral', 'No direction · neutral strategies only');
    default:
      return formatScenarioBanner('muted', 'No trade · stay out');
  }
}

function tradeActionLabel(action: DecisionAction): string {
  switch (action) {
    case 'CE-BUY':
      return 'Buy Call (CE)';
    case 'PE-BUY':
      return 'Buy Put (PE)';
    case 'NEUTRAL':
      return 'Neutral';
    default:
      return 'No trade';
  }
}

function biasEmoji(bias: TradeBias): string {
  if (bias === 'Strong Bullish') return '📈';
  if (bias === 'Moderate Bullish') return '📈';
  if (bias === 'Strong Bearish') return '📉';
  if (bias === 'Moderate Bearish') return '📉';
  return '⏸';
}

function priceActionLine(paAction: string, confidence: number): string {
  if (paAction === 'CE-BUY') {
    return `📊 Price action: CE-BUY (bullish) · ${confidence}%`;
  }
  if (paAction === 'PE-BUY') {
    return `📊 Price action: PE-BUY (bearish) · ${confidence}%`;
  }
  return `📊 Price action: ${paAction} · ${confidence}%`;
}

function optionRead(
  ofBias: string | undefined,
  action: DecisionAction,
): string | null {
  if (!ofBias) return null;

  const lower = ofBias.toLowerCase();
  const optionsUp = lower.includes('bullish');
  const optionsDown = lower.includes('bearish');
  if (!optionsUp && !optionsDown) return null;

  if (action === 'CE-BUY' && optionsDown) {
    return '⚠️ Options say DOWN — does not match this Call idea';
  }
  if (action === 'PE-BUY' && optionsUp) {
    return '⚠️ Options say UP — does not match this Put idea';
  }
  if (optionsUp) return '🌊 Options agree: UP';
  if (optionsDown) return '🌊 Options agree: DOWN';
  return null;
}

function strikeTitle(action: DecisionAction): string {
  if (action === 'CE-BUY') return '<b>BUY THIS CALL</b>';
  if (action === 'PE-BUY') return '<b>BUY THIS PUT</b>';
  return '<b>SUGGESTED STRIKE</b>';
}

function strategyRankEmoji(index: number): string {
  return ['🥇', '🥈', '🥉'][index] ?? '▫️';
}

function formatChangeLine(
  previous: SignalSnapshot | null,
  current: SignalSnapshot,
  kinds: SignalChangeKind[],
): string | null {
  if (!previous) return null;

  if (isSignalFlip(previous, current)) {
    return `🔄 Was ${tradeActionLabel(previous.action)} → now ${tradeActionLabel(current.action)}`;
  }

  if (kinds.includes('ACTION') || kinds.includes('INITIAL')) {
    return `🔄 Was ${tradeActionLabel(previous.action)} → now ${tradeActionLabel(current.action)}`;
  }

  const parts: string[] = [];
  if (kinds.includes('PA_SIGNAL') && previous.paAction !== current.paAction) {
    parts.push(`chart ${previous.paAction} → ${current.paAction}`);
  }
  if (kinds.includes('TRADE_READY')) {
    parts.push('enter bar met');
  }
  return parts.length ? `🔄 ${parts.join(' · ')}` : null;
}

function formatInr(value: number, maximumFractionDigits = 0): string {
  return value.toLocaleString('en-IN', { maximumFractionDigits });
}

export function formatPositionSizingTelegramSection(
  sizing: TelegramPositionSizing | undefined,
): string | null {
  if (!sizing) return null;

  if (sizing.unavailableReason && sizing.availableBalance == null) {
    return wrapScenarioCallout('warning', '<b>🏦 Wallet</b>', [
      escapeHtml(sizing.unavailableReason),
    ]);
  }

  const lines: string[] = [];

  if (sizing.availableBalance != null) {
    lines.push(`💳 ₹${formatInr(sizing.availableBalance)} available`);
  }

  if (sizing.unavailableReason) {
    lines.push(escapeHtml(sizing.unavailableReason));
    return wrapScenarioCallout('info', '<b>🏦 Wallet</b>', lines);
  }

  if (
    sizing.recommendedLots == null ||
    sizing.riskBudgetInr == null ||
    sizing.riskPoints == null ||
    sizing.riskPercent == null
  ) {
    return lines.length
      ? wrapScenarioCallout('info', '<b>🏦 Wallet</b>', lines)
      : null;
  }

  const lotLabel =
    sizing.recommendedLots === 1
      ? `1 lot (${sizing.lotSize} qty)`
      : `${sizing.recommendedLots} lots`;

  lines.push(
    `🎯 ${lotLabel} · ${escapeHtml(sizing.indexLabel)}`,
  );
  lines.push(
    `🛑 ${sizing.riskPoints.toFixed(1)} pts · ${sizing.riskPercent}% risk · ₹${formatInr(sizing.riskBudgetInr)} budget`,
  );

  if (sizing.recommendedLots < 1) {
    lines.push('Not enough margin for 1 lot at this stop.');
  }

  return wrapScenarioCallout('info', '<b>🏦 Wallet</b>', lines);
}

function gammaEmoji(level: GreeksStrikeProfile['gammaLevel']): string {
  if (level === 'high') return '⚡';
  if (level === 'moderate') return '〰️';
  return '💤';
}

function formatExactStrikeSection(
  strike: TradeDecisionAlertPayload['exactStrikeRecommendation'],
  action: DecisionAction,
): string | null {
  if (!strike) return null;
  return formatEnginePickCallout(strike, strikeTitle(action));
}

function formatAdaptiveConvictionLine(
  adaptive: TradeDecisionAlertPayload['adaptiveConviction'],
  conviction: number,
): string | null {
  if (!adaptive || adaptive.dataSource === 'defaults') return null;

  const meets = conviction >= adaptive.recommendedEnterThreshold;
  const icon = meets ? '✅' : '⚠️';
  return `${icon} Your enter bar: ${adaptive.recommendedEnterThreshold}% (${adaptive.overallWinRate}% wins on ${adaptive.sampleSize} past alerts)`;
}

export function formatGreeksStrikeSection(
  insight: GreeksStrikeInsight | undefined,
  options?: { includeBestFit?: boolean },
): string | null {
  if (!insight?.profiles.length) return null;

  const lines: string[] = [formatGreeksSectionHeader(insight.optionSide)];

  for (const profile of insight.profiles) {
    const delta =
      profile.delta != null ? `Δ${profile.delta.toFixed(2)}` : 'Δ—';
    const gamma = `${gammaEmoji(profile.gammaLevel)}Γ ${profile.gammaLevel}`;
    const theta = profile.thetaLabel ? `Θ${profile.thetaLabel}` : '';
    const premium =
      profile.premium != null ? ` · ₹${profile.premium.toFixed(0)}` : '';

    lines.push(
      `${gammaRowPrefix(profile)}<b>${profile.moneyness}</b> ${formatInr(profile.strike)} · ${delta} · ${gamma}${theta ? ` · ${theta}` : ''}${premium}`,
    );
  }

  if (options?.includeBestFit !== false) {
    lines.push(`💡 ${escapeHtml(insight.bestFit)}`);
  }

  return lines.join('\n');
}

function formatStrategies(strategies: RecommendedStrategyAlert[]): string | null {
  if (!strategies.length) return null;

  return strategies
    .slice(0, 2)
    .map((s, i) => {
      const rank = strategyRankEmoji(i);
      const conf =
        s.confidenceScore != null ? ` · ${s.confidenceScore}%` : '';
      const hint = s.executionHint
        ? ` — ${escapeHtml(s.executionHint)}`
        : s.reason
          ? ` — ${escapeHtml(s.reason)}`
          : '';
      return `${rank} <b>${escapeHtml(s.strategy)}</b>${conf}${hint}`;
    })
    .join('\n');
}

function formatPlaybookSection(
  strategies: RecommendedStrategyAlert[],
): string | null {
  const list = formatStrategies(strategies);
  if (!list) return null;

  return [
    formatSectionHeader('info', 'Playbook', '🎲'),
    '<i>Other option structures (spreads, condors, etc.) — not the single strike above.</i>',
    list,
  ].join('\n');
}

export function formatTelegramAlertMessage(params: {
  payload: TradeDecisionAlertPayload;
  previous: SignalSnapshot | null;
  current: SignalSnapshot;
  kinds: SignalChangeKind[];
}): string {
  const { payload, previous, current, kinds } = params;
  const label = shortSymbol(payload.symbol);
  const flipped = isSignalFlip(previous, current);
  const headline = tradeHeadline(payload.action, flipped);
  const pa = payload.priceAction;
  const iv = payload.optionFlow?.ivRegime;
  const change = formatChangeLine(previous, current, kinds);
  const exactStrike = formatExactStrikeSection(
    payload.exactStrikeRecommendation,
    payload.action,
  );
  const adaptiveLine = formatAdaptiveConvictionLine(
    payload.adaptiveConviction,
    payload.conviction,
  );
  const readyScenario = scenarioForTradeReady(
    payload.tradeGuidance.shouldConsiderTrade,
  );
  const readyIcon = readyScenario === 'success' ? '✅' : '⚠️';
  const readyText =
    readyScenario === 'success'
      ? 'OK to enter'
      : 'Wait or size down';
  const biasIcon = biasEmoji(payload.bias);

  const showGreeks = !exactStrike;
  const compactGreeks = showGreeks
    ? formatGreeksStrikeSection(payload.optionFlow?.greeksStrikeInsight, {
        includeBestFit: false,
      })
    : null;

  const playbook = formatPlaybookSection(payload.recommendedStrategies);

  const identityBlock = joinTelegramLines(
    `<b>${escapeHtml(label)}</b> · ${payload.tradingStyle} · ${tradeActionLabel(payload.action)}`,
    `💰 Spot ${payload.lastPrice.toLocaleString('en-IN')} · ${biasIcon} ${escapeHtml(payload.bias)} · ${payload.conviction}% conviction`,
  );

  const readsBlock = joinTelegramLines(
    priceActionLine(pa.action, pa.confidence),
    optionRead(payload.optionFlow?.bias, payload.action),
    iv ? `🌡 IV: ${escapeHtml(iv)}` : null,
  );

  const enterBlock = joinTelegramLines(
    adaptiveLine,
    `${readyIcon} ${readyText}${payload.tradeGuidance.sizeRecommendation ? ` · ${escapeHtml(payload.tradeGuidance.sizeRecommendation)}` : ''}`,
  );

  return joinTelegramSections(
    headline,
    identityBlock,
    readsBlock,
    enterBlock,
    formatPositionSizingTelegramSection(payload.positionSizing),
    exactStrike,
    compactGreeks,
    playbook,
    change,
  );
}