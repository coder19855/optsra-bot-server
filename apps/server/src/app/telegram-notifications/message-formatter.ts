import {
  GreeksStrikeInsight,
  GreeksStrikeProfile,
} from '../types/greeks-strike-insight';
import {
  RecommendedStrategyAlert,
  SignalAlertTone,
  SignalChangeKind,
  SignalSnapshot,
  TelegramPositionSizing,
  TradeDecisionAlertPayload,
} from '../types/telegram-notifications';
import {
  AlertFormatMode,
  DEFAULT_ALERT_FORMAT,
} from '../types/alert-format';
import { DecisionAction, TradeBias } from '../types/trade-decision';
import { DEFAULT_TELEGRAM_VOICE, TelegramVoice } from '../types/telegram-voice';
import { joinTelegramLines, joinTelegramSections } from './message-layout';
import {
  adaptiveConvictionLine,
  playbookSectionNote,
  playbookSectionTitle,
  signalActionLabel,
  signalChangeLine,
  signalConvictionLine,
  signalHeadline,
  signalOptionRead,
  signalPriceActionLine,
  signalReadyText,
  signalStrikeTitle,
  walletSectionTitle,
} from './voice-copy';
import { formatTradeContextLines, formatVetoSection } from './trade-context-copy';
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

function tradeHeadlineBanner(
  action: DecisionAction,
  flipped: boolean,
  voice: TelegramVoice,
  options?: {
    alertTone?: SignalAlertTone;
    exitReason?: string | null;
    kinds?: SignalChangeKind[];
  },
): string {
  const text = signalHeadline({
    voice,
    action,
    flipped,
    alertTone: options?.alertTone,
    kinds: options?.kinds,
    exitReason: options?.exitReason,
  });

  if (options?.alertTone === 'hard_exit' || options?.kinds?.includes('HARD_EXIT')) {
    return formatScenarioBanner('danger', text);
  }
  if (
    options?.alertTone === 'caution' ||
    options?.kinds?.includes('EDGE_FADE')
  ) {
    return formatScenarioBanner('warning', text);
  }
  if (flipped) {
    return formatScenarioBanner(scenarioForSignalFlip(), text);
  }
  switch (action) {
    case 'CE-BUY':
      return formatScenarioBanner('bullish', text);
    case 'PE-BUY':
      return formatScenarioBanner('bearish', text);
    case 'NEUTRAL':
      return formatScenarioBanner('neutral', text);
    default:
      return formatScenarioBanner('muted', text);
  }
}

function biasEmoji(bias: TradeBias): string {
  if (bias === 'Strong Bullish') return '📈';
  if (bias === 'Moderate Bullish') return '📈';
  if (bias === 'Strong Bearish') return '📉';
  if (bias === 'Moderate Bearish') return '📉';
  return '⏸';
}

function priceActionLine(
  pa: TradeDecisionAlertPayload['priceAction'],
  brainAction: DecisionAction,
  voice: TelegramVoice,
): string {
  const { action: paAction, confidence, structuralAction, vetoReason } = pa;
  const beforeDecay = pa.confidenceBeforeDecay;

  const chartVetoed =
    confidence === 0 ||
    (brainAction === 'NO-TRADE' &&
      (paAction === 'NO-TRADE' ||
        structuralAction === 'CE-BUY' ||
        structuralAction === 'PE-BUY'));

  if (chartVetoed && vetoReason && voice === 'trader') {
    return `📊 Price action: NO-TRADE · ${escapeHtml(vetoReason)}`;
  }

  return signalPriceActionLine({
    voice,
    paAction,
    confidence,
    brainAction,
    chartVetoed,
    structuralAction,
    vetoReason,
    beforeDecay,
  });
}

function strategyRankEmoji(index: number): string {
  return ['🥇', '🥈', '🥉'][index] ?? '▫️';
}

function formatChangeLine(
  previous: SignalSnapshot | null,
  current: SignalSnapshot,
  kinds: SignalChangeKind[],
  voice: TelegramVoice,
  options?: { exitReason?: string | null },
): string | null {
  const primary = signalChangeLine({
    voice,
    previous,
    current,
    kinds,
    exitReason: options?.exitReason,
    isFlip: Boolean(previous && isSignalFlip(previous, current)),
  });
  if (primary) return primary;

  if (!previous) return null;

  const parts: string[] = [];
  if (kinds.includes('PA_SIGNAL') && previous.paAction !== current.paAction) {
    parts.push(`chart ${previous.paAction} → ${current.paAction}`);
  }
  if (kinds.includes('TRADE_READY')) {
    parts.push(voice === 'trader' ? 'enter bar met' : 'enter bar OK');
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

  return wrapScenarioCallout('info', `<b>🏦 ${walletSectionTitle('trader')}</b>`, lines);
}

function formatPositionSizingWithVoice(
  sizing: TelegramPositionSizing | undefined,
  voice: TelegramVoice,
): string | null {
  const section = formatPositionSizingTelegramSection(sizing);
  if (!section || voice === 'trader') return section;
  return section.replace(
    '<b>🏦 Wallet</b>',
    `<b>🏦 ${walletSectionTitle(voice)}</b>`,
  );
}

function gammaEmoji(level: GreeksStrikeProfile['gammaLevel']): string {
  if (level === 'high') return '⚡';
  if (level === 'moderate') return '〰️';
  return '💤';
}

function formatExactStrikeSection(
  strike: TradeDecisionAlertPayload['exactStrikeRecommendation'],
  action: DecisionAction,
  voice: TelegramVoice,
): string | null {
  if (!strike) return null;
  return formatEnginePickCallout(strike, signalStrikeTitle(action, voice));
}

function formatAdaptiveConvictionLine(
  adaptive: TradeDecisionAlertPayload['adaptiveConviction'],
  conviction: number,
  voice: TelegramVoice,
): string | null {
  if (
    !adaptive ||
    adaptive.dataSource === 'defaults' ||
    adaptive.overallWinRate == null
  ) {
    return null;
  }

  return adaptiveConvictionLine({
    voice,
    recommendedEnterThreshold: adaptive.recommendedEnterThreshold,
    overallWinRate: adaptive.overallWinRate,
    sampleSize: adaptive.sampleSize,
    conviction,
  });
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
  voice: TelegramVoice,
): string | null {
  const list = formatStrategies(strategies);
  if (!list) return null;

  return [
    formatSectionHeader('info', playbookSectionTitle(voice), '🎲'),
    `<i>${playbookSectionNote(voice)}</i>`,
    list,
  ].join('\n');
}

const COMPACT_DECK_HINT =
  '📱 PA · flow · Greeks · playbook → open Deck';

function formatCompactTelegramAlertMessage(params: {
  payload: TradeDecisionAlertPayload;
  previous: SignalSnapshot | null;
  current: SignalSnapshot;
  kinds: SignalChangeKind[];
  alertTone?: SignalAlertTone;
  exitReason?: string | null;
  voice: TelegramVoice;
}): string {
  const {
    payload,
    previous,
    current,
    kinds,
    alertTone,
    exitReason,
    voice,
  } = params;
  const label = shortSymbol(payload.symbol);
  const flipped = isSignalFlip(previous, current);
  const headline = tradeHeadlineBanner(payload.action, flipped, voice, {
    alertTone,
    exitReason,
    kinds,
  });
  const pa = payload.priceAction;
  const biasIcon = biasEmoji(payload.bias);
  const change = formatChangeLine(previous, current, kinds, voice, { exitReason });
  const exactStrike = formatExactStrikeSection(
    payload.exactStrikeRecommendation,
    payload.action,
    voice,
  );

  const chartVetoed =
    pa.confidence === 0 ||
    (payload.action === 'NO-TRADE' &&
      (pa.action === 'NO-TRADE' ||
        pa.structuralAction === 'CE-BUY' ||
        pa.structuralAction === 'PE-BUY'));

  const vetoOneLiner = chartVetoed
    ? priceActionLine(pa, payload.action, voice)
    : null;

  const identityBlock = joinTelegramLines(
    `<b>${escapeHtml(label)}</b> · ${payload.tradingStyle} · ${signalActionLabel(payload.action, voice)}`,
    `💰 Spot ${payload.lastPrice.toLocaleString('en-IN')} · ${biasIcon} ${escapeHtml(payload.bias)} · ${signalConvictionLine(payload.conviction, voice)}`,
  );

  return joinTelegramSections(
    headline,
    identityBlock,
    vetoOneLiner,
    exactStrike,
    change,
    COMPACT_DECK_HINT,
  );
}

export function formatTelegramAlertMessage(params: {
  payload: TradeDecisionAlertPayload;
  previous: SignalSnapshot | null;
  current: SignalSnapshot;
  kinds: SignalChangeKind[];
  alertTone?: SignalAlertTone;
  exitReason?: string | null;
  voice?: TelegramVoice;
  alertFormat?: AlertFormatMode;
}): string {
  const {
    payload,
    previous,
    current,
    kinds,
    alertTone,
    exitReason,
    voice = DEFAULT_TELEGRAM_VOICE,
    alertFormat = DEFAULT_ALERT_FORMAT,
  } = params;

  if (alertFormat === 'compact') {
    return formatCompactTelegramAlertMessage({
      payload,
      previous,
      current,
      kinds,
      alertTone,
      exitReason,
      voice,
    });
  }
  const label = shortSymbol(payload.symbol);
  const flipped = isSignalFlip(previous, current);
  const headline = tradeHeadlineBanner(payload.action, flipped, voice, {
    alertTone,
    exitReason,
    kinds,
  });
  const pa = payload.priceAction;
  const iv = payload.optionFlow?.ivRegime;
  const change = formatChangeLine(previous, current, kinds, voice, { exitReason });
  const exactStrike = formatExactStrikeSection(
    payload.exactStrikeRecommendation,
    payload.action,
    voice,
  );
  const adaptiveLine = formatAdaptiveConvictionLine(
    payload.adaptiveConviction,
    payload.conviction,
    voice,
  );
  const readyScenario = scenarioForTradeReady(
    payload.tradeGuidance.shouldConsiderTrade,
  );
  const readyIcon = readyScenario === 'success' ? '✅' : '⚠️';
  const readyText = signalReadyText(
    payload.tradeGuidance.shouldConsiderTrade,
    voice,
  );
  const biasIcon = biasEmoji(payload.bias);

  const showGreeks = !exactStrike;
  const compactGreeks = showGreeks
    ? formatGreeksStrikeSection(payload.optionFlow?.greeksStrikeInsight, {
        includeBestFit: false,
      })
    : null;

  const playbook = formatPlaybookSection(payload.recommendedStrategies, voice);

  const contextLines = formatTradeContextLines(
    payload.action,
    payload.bias,
    payload.conviction,
    payload.structureContext,
    voice,
  );

  const vetoSection = formatVetoSection(
    {
      action: payload.action,
      bias: payload.bias,
      conviction: payload.conviction,
      structureContext: payload.structureContext,
      priceAction: pa,
    },
    voice,
  );

  const identityBlock = joinTelegramLines(
    `<b>${escapeHtml(label)}</b> · ${payload.tradingStyle} · ${signalActionLabel(payload.action, voice)}`,
    `💰 Spot ${payload.lastPrice.toLocaleString('en-IN')} · ${biasIcon} ${escapeHtml(payload.bias)} · ${signalConvictionLine(payload.conviction, voice)}`,
    ...contextLines,
    vetoSection,
  );

  const readsBlock = joinTelegramLines(
    vetoSection ? null : priceActionLine(pa, payload.action, voice),
    signalOptionRead(payload.optionFlow?.bias, payload.action, voice),
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
    formatPositionSizingWithVoice(payload.positionSizing, voice),
    exactStrike,
    compactGreeks,
    playbook,
    change,
  );
}