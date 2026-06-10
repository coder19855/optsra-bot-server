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
import {
  formatEnginePickCallout,
  formatGreeksSectionHeader,
  gammaRowPrefix,
} from './strike-callouts';
import {
  formatScenarioBanner,
  formatSectionHeader,
  paletteToken,
  scenarioForAction,
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

function actionBanner(action: DecisionAction, flipped: boolean): string {
  if (flipped) {
    return formatScenarioBanner(
      scenarioForSignalFlip(),
      'Plot twist — direction flipped!',
    );
  }
  switch (action) {
    case 'CE-BUY':
      return formatScenarioBanner('bullish', 'Calls are cooking');
    case 'PE-BUY':
      return formatScenarioBanner('bearish', 'Puts have the mic');
    case 'NEUTRAL':
      return formatScenarioBanner('neutral', 'Chop zone — sit tight');
    default:
      return formatScenarioBanner('muted', 'Nothing to chase');
  }
}

function actionEmoji(action: DecisionAction): string {
  return paletteToken(scenarioForAction(action)).accent;
}

function biasEmoji(bias: TradeBias): string {
  if (bias === 'Strong Bullish') return '📈📈';
  if (bias === 'Moderate Bullish') return '📈';
  if (bias === 'Strong Bearish') return '📉📉';
  if (bias === 'Moderate Bearish') return '📉';
  return '⏸';
}

function convictionMeter(conviction: number): string {
  if (conviction >= 75) return '🔥🔥🔥';
  if (conviction >= 55) return '🔥🔥';
  if (conviction >= 35) return '🔥';
  return '💤';
}

function paEmoji(action: string): string {
  if (action === 'CE-BUY') return '📈';
  if (action === 'PE-BUY') return '📉';
  return '➖';
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
    return `🚨 ${previous.action} ➜ ${current.action}`;
  }

  const parts: string[] = [];
  if (kinds.includes('ACTION') || kinds.includes('INITIAL')) {
    parts.push(`${previous.action} ➜ ${current.action}`);
  }
  if (kinds.includes('PA_SIGNAL')) {
    parts.push(`PA ${previous.paAction} ➜ ${current.paAction}`);
  }
  if (kinds.includes('BIAS') && previous.bias !== current.bias) {
    parts.push(`${previous.bias} ➜ ${current.bias}`);
  }
  if (kinds.includes('TRADE_READY')) {
    parts.push('Trade-ready');
  }
  if (kinds.includes('STRATEGY')) {
    parts.push(
      `${previous.topStrategy || '—'} ➜ ${current.topStrategy || '—'}`,
    );
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
): string | null {
  if (!strike) return null;
  return formatEnginePickCallout(strike, '<b>🎯 STRIKE</b>');
}

function formatAdaptiveConvictionLine(
  adaptive: TradeDecisionAlertPayload['adaptiveConviction'],
  conviction: number,
): string | null {
  if (!adaptive || adaptive.dataSource === 'defaults') return null;

  const meets = conviction >= adaptive.recommendedEnterThreshold;
  const icon = meets ? '✅' : '⚠️';
  return `${icon} Enter bar ${adaptive.recommendedEnterThreshold}% · ${adaptive.overallWinRate}% wins (${adaptive.sampleSize} alerts)`;
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

export function formatTelegramAlertMessage(params: {
  payload: TradeDecisionAlertPayload;
  previous: SignalSnapshot | null;
  current: SignalSnapshot;
  kinds: SignalChangeKind[];
}): string {
  const { payload, previous, current, kinds } = params;
  const label = shortSymbol(payload.symbol);
  const flipped = isSignalFlip(previous, current);
  const banner = actionBanner(payload.action, flipped);
  const emoji = actionEmoji(payload.action);
  const pa = payload.priceAction;
  const iv = payload.optionFlow?.ivRegime;
  const ofBias = payload.optionFlow?.bias;
  const change = formatChangeLine(previous, current, kinds);
  const strategies = formatStrategies(payload.recommendedStrategies);
  const exactStrike = formatExactStrikeSection(
    payload.exactStrikeRecommendation,
  );
  const adaptiveLine = formatAdaptiveConvictionLine(
    payload.adaptiveConviction,
    payload.conviction,
  );
  const meter = convictionMeter(payload.conviction);
  const biasIcon = biasEmoji(payload.bias);
  const readyScenario = scenarioForTradeReady(
    payload.tradeGuidance.shouldConsiderTrade,
  );
  const readyIcon = readyScenario === 'success' ? '✅' : '⚠️';
  const readyText =
    readyScenario === 'success' ? 'Trade-ready' : 'Below bar — wait/size down';
  const flowBits = [
    `${paEmoji(pa.action)} PA ${pa.action} ${pa.confidence}%`,
    ofBias ? `🌊 ${escapeHtml(ofBias)}` : null,
    iv ? `🌡 ${escapeHtml(iv)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const showGreeks = !exactStrike;
  const compactGreeks = showGreeks
    ? formatGreeksStrikeSection(payload.optionFlow?.greeksStrikeInsight, {
        includeBestFit: false,
      })
    : null;

  return [
    banner,
    `${emoji} <b>${escapeHtml(label)} · ${payload.tradingStyle} · ${payload.action}</b> · ${meter} ${payload.conviction}%`,
    `💰 ${payload.lastPrice.toLocaleString('en-IN')} · ${biasIcon} ${escapeHtml(payload.bias)}`,
    flowBits || null,
    adaptiveLine,
    `${readyIcon} ${readyText}${payload.tradeGuidance.sizeRecommendation ? ` · ${escapeHtml(payload.tradeGuidance.sizeRecommendation)}` : ''}`,
    formatPositionSizingTelegramSection(payload.positionSizing),
    exactStrike,
    compactGreeks,
    strategies ? formatSectionHeader('info', 'Playbook', '🎲') : null,
    strategies,
    `🧠 ${escapeHtml(payload.humanSummary)}`,
    change,
  ]
    .filter((line) => line !== null && line !== '')
    .join('\n');
}