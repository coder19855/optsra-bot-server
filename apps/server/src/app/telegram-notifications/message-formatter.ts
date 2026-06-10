import {
  RecommendedStrategyAlert,
  SignalChangeKind,
  SignalSnapshot,
  TelegramPositionSizing,
  TradeDecisionAlertPayload,
} from '../types/telegram-notifications';
import { DecisionAction, TradeBias } from '../types/trade-decision';

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
  if (flipped) return '🚨🔁 SIGNAL FLIP 🔁🚨';
  switch (action) {
    case 'CE-BUY':
      return '🟢📈 BULLISH CALL SETUP 📈🟢';
    case 'PE-BUY':
      return '🔴📉 BEARISH PUT SETUP 📉🔴';
    case 'NEUTRAL':
      return '🟡⚖️ NEUTRAL / RANGE PLAY ⚖️🟡';
    default:
      return '⚪🛑 NO TRADE — STAY FLAT 🛑⚪';
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
  if (!previous) return '🚀 First actionable signal this session.';

  if (isSignalFlip(previous, current)) {
    return `🚨 ${previous.action} ➜ ${current.action} — direction reversed!`;
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
    parts.push(`${changeKindEmoji('TRADE_READY')} Trade threshold crossed`);
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

function formatPositionSizingSection(
  sizing: TelegramPositionSizing | undefined,
): string | null {
  if (!sizing) return null;

  if (sizing.unavailableReason && sizing.availableBalance == null) {
    return `🏦 <b>Account sizing</b>\n⚠️ ${escapeHtml(sizing.unavailableReason)}`;
  }

  const lines: string[] = ['🏦 <b>Account sizing (Fyers)</b>'];

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
    lines.push('⛔ Risk budget too small for 1 lot at this stop — skip or add funds.');
  }

  return lines.join('\n');
}

function formatStrategies(strategies: RecommendedStrategyAlert[]): string {
  if (!strategies.length) {
    return '❓ No mapped strategies — review option flow manually.';
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
  const meter = convictionMeter(payload.conviction);
  const biasIcon = biasEmoji(payload.bias);

  const tradeReady = payload.tradeGuidance.shouldConsiderTrade
    ? '✅🟢 Meets style conviction threshold'
    : '⏸🟡 Below style threshold — caution';

  return [
    banner,
    `${emoji} <b>${escapeHtml(label)} · ${escapeHtml(payload.tradingStyle)} · ${payload.action}</b>`,
    '━━━━━━━━━━━━━━━━━━━━',
    `${meter} <b>Conviction:</b> ${payload.conviction}%`,
    `${biasIcon} <b>Bias:</b> ${escapeHtml(payload.bias)}`,
    `💰 <b>Price:</b> ${payload.lastPrice.toLocaleString('en-IN')}`,
    `${paEmoji(pa.action)} <b>PA:</b> ${pa.action} (${pa.confidence}%)`,
    ofBias ? `🌊 <b>Option flow:</b> ${escapeHtml(ofBias)}` : null,
    iv ? `⚡ <b>IV regime:</b> ${escapeHtml(iv)}` : null,
    '━━━━━━━━━━━━━━━━━━━━',
    `🧭 <b>Trade guidance</b>`,
    tradeReady,
    payload.tradeGuidance.sizeRecommendation
      ? `📏 ${escapeHtml(payload.tradeGuidance.sizeRecommendation)}`
      : null,
    '',
    formatPositionSizingSection(payload.positionSizing),
    '',
    `🎲 <b>Top strategies</b>`,
    strategies,
    '',
    `🧠 <b>Summary</b>`,
    escapeHtml(payload.humanSummary),
    '━━━━━━━━━━━━━━━━━━━━',
    `🔄 <b>What changed</b>`,
    change,
  ]
    .filter((line) => line !== null)
    .join('\n');
}