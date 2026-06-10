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
import { TELEGRAM_MSG_RULE } from './message-layout';

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
  if (flipped) return '🚨 <b>Plot twist — direction flipped!</b>';
  switch (action) {
    case 'CE-BUY':
      return '🟢📈 <b>Calls are cooking</b>';
    case 'PE-BUY':
      return '🔴📉 <b>Puts have the mic</b>';
    case 'NEUTRAL':
      return '🟡 <b>Chop zone — sit tight</b>';
    default:
      return '⚪ <b>Nothing to chase</b>';
  }
}

function actionEmoji(action: DecisionAction): string {
  if (action === 'CE-BUY') return '🟢';
  if (action === 'PE-BUY') return '🔴';
  if (action === 'NEUTRAL') return '🟡';
  return '⚪';
}

function biasEmoji(bias: TradeBias): string {
  if (bias === 'Strong Bullish') return '🟢🟢';
  if (bias === 'Moderate Bullish') return '🟢';
  if (bias === 'Strong Bearish') return '🔴🔴';
  if (bias === 'Moderate Bearish') return '🔴';
  return '🟡';
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

function riskEmoji(risk?: string): string {
  const r = (risk || '').toLowerCase();
  if (r.includes('low')) return '🟢';
  if (r.includes('high')) return '🔴';
  if (r.includes('medium') || r.includes('med')) return '🟡';
  return '⚪';
}

function strategyRankEmoji(index: number): string {
  return ['🥇', '🥈', '🥉'][index] ?? '▫️';
}

function changeKindEmoji(kind: SignalChangeKind): string {
  switch (kind) {
    case 'ACTION':
      return '🔀';
    case 'PA_SIGNAL':
      return '📊';
    case 'BIAS':
      return '🧭';
    case 'TRADE_READY':
      return '✅';
    case 'STRATEGY':
      return '🎯';
    case 'INITIAL':
      return '🚀';
    default:
      return '🔄';
  }
}

function formatChangeLine(
  previous: SignalSnapshot | null,
  current: SignalSnapshot,
  kinds: SignalChangeKind[],
): string {
  if (!previous) return '🚀 First real setup of the session — eyes up.';

  if (isSignalFlip(previous, current)) {
    return `🚨 ${previous.action} ➜ ${current.action} — market changed its mind!`;
  }

  const parts: string[] = [];
  if (kinds.includes('ACTION') || kinds.includes('INITIAL')) {
    parts.push(
      `${changeKindEmoji('ACTION')} ${previous.action} ➜ ${current.action}`,
    );
  }
  if (kinds.includes('PA_SIGNAL')) {
    parts.push(
      `${changeKindEmoji('PA_SIGNAL')} PA ${previous.paAction} ➜ ${current.paAction}`,
    );
  }
  if (kinds.includes('BIAS')) {
    parts.push(
      `${changeKindEmoji('BIAS')} ${previous.bias} ➜ ${current.bias}`,
    );
  }
  if (kinds.includes('TRADE_READY')) {
    parts.push(`${changeKindEmoji('TRADE_READY')} Conviction bar cleared — trade-ready`);
  }
  if (kinds.includes('STRATEGY')) {
    parts.push(
      `${changeKindEmoji('STRATEGY')} ${previous.topStrategy || '—'} ➜ ${current.topStrategy || '—'}`,
    );
  }
  return parts.join('\n') || '🔄 Signal updated';
}

function formatInr(value: number, maximumFractionDigits = 0): string {
  return value.toLocaleString('en-IN', { maximumFractionDigits });
}

function tierLabel(label: string): string {
  if (label === 'conservative') return '🛡 Conservative';
  if (label === 'aggressive') return '⚡ Aggressive';
  return '📏 Standard';
}

export function formatPositionSizingTelegramSection(
  sizing: TelegramPositionSizing | undefined,
): string | null {
  if (!sizing) return null;

  if (sizing.unavailableReason && sizing.availableBalance == null) {
    return `🏦 <b>Wallet check</b>\n⚠️ ${escapeHtml(sizing.unavailableReason)}`;
  }

  const lines: string[] = ['🏦 <b>Wallet check (Fyers)</b>'];

  if (sizing.availableBalance != null) {
    lines.push(
      `💳 <b>Available:</b> ₹${formatInr(sizing.availableBalance)}`,
    );
    if (sizing.totalBalance != null) {
      lines.push(`📊 Total balance: ₹${formatInr(sizing.totalBalance)}`);
    }
  }

  if (sizing.unavailableReason) {
    lines.push(`⚠️ ${escapeHtml(sizing.unavailableReason)}`);
    return lines.join('\n');
  }

  if (
    sizing.recommendedLots == null ||
    sizing.riskBudgetInr == null ||
    sizing.riskPoints == null ||
    sizing.riskPercent == null
  ) {
    return lines.join('\n');
  }

  const qtyPerLot = sizing.lotSize;
  const recommendedQty = sizing.recommendedLots * qtyPerLot;
  const lotLabel =
    sizing.recommendedLots === 1
      ? `1 lot (${qtyPerLot} qty)`
      : `${sizing.recommendedLots} lots (${recommendedQty} qty)`;

  lines.push(
    `🎯 <b>Recommended:</b> ${lotLabel} · ${escapeHtml(sizing.indexLabel)}`,
  );
  lines.push(
    `📉 Risk budget (${sizing.riskPercent}%): ₹${formatInr(sizing.riskBudgetInr)}`,
  );
  lines.push(
    `🛑 Stop risk: ${sizing.riskPoints.toFixed(1)} index pts · ₹${formatInr(sizing.riskPerLotInr ?? 0)}/lot`,
  );

  if (sizing.capitalAtRiskInr != null) {
    lines.push(`💸 Capital at risk: ₹${formatInr(sizing.capitalAtRiskInr)}`);
  }

  if (sizing.marginRequiredInr != null && sizing.marginRequiredInr > 0) {
    const util =
      sizing.utilizationPercent != null
        ? ` (${sizing.utilizationPercent}% of available)`
        : '';
    lines.push(
      `🏧 Est. margin: ₹${formatInr(sizing.marginRequiredInr)}${util}`,
    );
  }

  if (
    sizing.atmStrike != null &&
    sizing.atmPremium != null &&
    sizing.optionSide
  ) {
    lines.push(
      `📌 ATM ${sizing.optionSide} @ ${formatInr(sizing.atmStrike)} · premium ₹${sizing.atmPremium.toFixed(1)}`,
    );
  }

  if (sizing.tiers?.length) {
    const tierLine = sizing.tiers
      .map(
        (tier) =>
          `${tierLabel(tier.label)}: ${tier.lots} lot${tier.lots === 1 ? '' : 's'}`,
      )
      .join(' · ');
    lines.push(tierLine);
  }

  if (sizing.recommendedLots < 1) {
    lines.push('⛔ Not enough room for even 1 lot at this stop — pass or top up.');
  }

  return lines.join('\n');
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

  const move =
    strike.expectedPremiumMove50Pts != null
      ? ` · ~₹${strike.expectedPremiumMove50Pts.toFixed(1)}/50pts`
      : '';

  return [
    '🎯 <b>Strike ticket</b>',
    `<code>${escapeHtml(strike.fyersSymbol)}</code>`,
    `${strike.moneyness} @ ${formatInr(strike.strike)} · prem ₹${strike.premium.toFixed(1)} · Δ ${strike.delta?.toFixed(2) ?? '—'}${move}`,
    `↳ ${escapeHtml(strike.rationale)}`,
    '💬 Curious? Hit <code>/why</code> for the full story',
  ].join('\n');
}

function formatAdaptiveConvictionLine(
  adaptive: TradeDecisionAlertPayload['adaptiveConviction'],
  conviction: number,
): string | null {
  if (!adaptive || adaptive.dataSource === 'defaults') return null;

  const meets = conviction >= adaptive.recommendedEnterThreshold;
  const icon = meets ? '✅' : '⚠️';
  return `${icon} <b>Your enter bar:</b> ${adaptive.recommendedEnterThreshold}% (from your alert history)\n↳ ${adaptive.overallWinRate}% win rate · ${adaptive.sampleSize} past alerts`;
}

export function formatGreeksStrikeSection(
  insight: GreeksStrikeInsight | undefined,
): string | null {
  if (!insight?.profiles.length) return null;

  const lines: string[] = [
    `📐 <b>Greeks cheat sheet · ${insight.optionSide}</b>`,
    TELEGRAM_MSG_RULE,
  ];

  for (const profile of insight.profiles) {
    const delta =
      profile.delta != null ? `Δ ${profile.delta.toFixed(2)}` : 'Δ —';
    const gamma = `${gammaEmoji(profile.gammaLevel)} Γ ${profile.gammaLevel}`;
    const theta = profile.thetaLabel ? `Θ ${profile.thetaLabel}` : 'Θ —';
    const premium =
      profile.premium != null
        ? ` · prem ₹${profile.premium.toFixed(1)}`
        : '';

    lines.push(
      `<b>${profile.moneyness}</b> ${formatInr(profile.strike)} · ${delta} · ${gamma} · ${theta}${premium}`,
    );
    lines.push(`↳ ${escapeHtml(profile.consequence)}`);
  }

  lines.push(`💡 <b>Sweet spot for you:</b> ${escapeHtml(insight.bestFit)}`);
  if (insight.ivNote) {
    lines.push(`🌡 ${escapeHtml(insight.ivNote)}`);
  }

  return lines.join('\n');
}

function formatStrategies(strategies: RecommendedStrategyAlert[]): string {
  if (!strategies.length) {
    return '🤷 No playbook match — eyeball option flow yourself this time.';
  }

  return strategies
    .slice(0, 3)
    .map((s, i) => {
      const rank = strategyRankEmoji(i);
      const risk = riskEmoji(s.risk);
      const lines = [
        `${rank} <b>${escapeHtml(s.strategy)}</b>`,
        s.confidenceScore != null
          ? `   🎯 Confidence: ${s.confidenceScore}%`
          : null,
        s.risk ? `   ${risk} Risk: ${escapeHtml(s.risk)}` : null,
        s.executionHint
          ? `   ⚡ Execution: ${escapeHtml(s.executionHint)}`
          : null,
        s.reason ? `   💡 ${escapeHtml(s.reason)}` : null,
      ].filter(Boolean);
      return lines.join('\n');
    })
    .join('\n\n');
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
  const greeksStrike = formatGreeksStrikeSection(
    payload.optionFlow?.greeksStrikeInsight,
  );
  const exactStrike = formatExactStrikeSection(
    payload.exactStrikeRecommendation,
  );
  const adaptiveLine = formatAdaptiveConvictionLine(
    payload.adaptiveConviction,
    payload.conviction,
  );
  const meter = convictionMeter(payload.conviction);
  const biasIcon = biasEmoji(payload.bias);

  const tradeReady = payload.tradeGuidance.shouldConsiderTrade
    ? '✅ Green light — conviction clears your bar'
    : '⏸ Yellow light — below bar, size down or wait';

  return [
    banner,
    `${emoji} <b>${escapeHtml(label)} · ${escapeHtml(payload.tradingStyle)} · ${payload.action}</b>`,
    TELEGRAM_MSG_RULE,
    `${meter} <b>Conviction:</b> ${payload.conviction}%`,
    `${biasIcon} <b>Vibe:</b> ${escapeHtml(payload.bias)}`,
    `💰 <b>Spot:</b> ${payload.lastPrice.toLocaleString('en-IN')}`,
    `${paEmoji(pa.action)} <b>Price action:</b> ${pa.action} (${pa.confidence}%)`,
    ofBias ? `🌊 <b>Options desk:</b> ${escapeHtml(ofBias)}` : null,
    iv ? `🌡 <b>IV mood:</b> ${escapeHtml(iv)}` : null,
    adaptiveLine,
    TELEGRAM_MSG_RULE,
    `🧭 <b>Should you pull the trigger?</b>`,
    tradeReady,
    payload.tradeGuidance.sizeRecommendation
      ? `📏 ${escapeHtml(payload.tradeGuidance.sizeRecommendation)}`
      : null,
    '',
    formatPositionSizingTelegramSection(payload.positionSizing),
    '',
    greeksStrike,
    greeksStrike ? '' : null,
    exactStrike,
    exactStrike ? '' : null,
    `🎲 <b>Playbook picks</b>`,
    strategies,
    '',
    `🧠 <b>TL;DR</b>`,
    escapeHtml(payload.humanSummary),
    TELEGRAM_MSG_RULE,
    `🔄 <b>What just shifted</b>`,
    change,
  ]
    .filter((line) => line !== null)
    .join('\n');
}