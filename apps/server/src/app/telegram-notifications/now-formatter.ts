import { TELEGRAM_NOTIFICATION_DEFAULTS } from '../constants/telegram-notifications';
import { TradeDecisionAlertPayload } from '../types/telegram-notifications';
import { DecisionAction, TradeBias } from '../types/trade-decision';
import { TradingStyle } from '../types/trading-style';
import { joinTelegramLines, joinTelegramSections } from './message-layout';
import { formatScenarioBanner } from './telegram-palette';

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

function tradeHeadline(action: DecisionAction): string {
  switch (action) {
    case 'CE-BUY':
      return '📈 BUY CALL · index may go UP';
    case 'PE-BUY':
      return '📉 BUY PUT · index may go DOWN';
    case 'NEUTRAL':
      return '⏸ Neutral · spreads / no direction';
    default:
      return '💤 No trade · stay out';
  }
}

function biasEmoji(bias: TradeBias): string {
  if (bias.includes('Bullish')) return '📈';
  if (bias.includes('Bearish')) return '📉';
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

function formatIstTime(now = Date.now()): string {
  return new Date(now).toLocaleString('en-IN', {
    timeZone: TELEGRAM_NOTIFICATION_DEFAULTS.IST_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

export interface NowMarketContext {
  marketOpen: boolean;
  preSessionWindow: boolean;
  postSessionCoachWindow: boolean;
  isTokenValid: boolean;
  alertsPaused: boolean;
  fetchedAt?: number;
}

export function formatNowMarketContextBlock(ctx: NowMarketContext): string {
  const marketLine = ctx.marketOpen
    ? '🟢 Market open'
    : ctx.preSessionWindow
      ? '🌅 Pre-session window'
      : ctx.postSessionCoachWindow
        ? '📚 Post-session coach window'
        : '🌙 Outside market hours';

  return joinTelegramLines(
    formatScenarioBanner('info', 'Right now'),
    `🕐 ${formatIstTime(ctx.fetchedAt)} IST`,
    marketLine,
    ctx.isTokenValid
      ? '✅ Fyers session live'
      : '⚠️ Fyers not connected — <code>/login</code>',
    ctx.alertsPaused
      ? '⏸ Auto alerts paused — <code>/start</code> to resume'
      : '▶️ Auto alerts active',
    !ctx.marketOpen
      ? '<i>Market closed — read is informational, not a live alert.</i>'
      : null,
  );
}

export function formatNowWatchItem(payload: TradeDecisionAlertPayload): string {
  const label = shortSymbol(payload.symbol);
  const pa = payload.priceAction;
  const iv = payload.optionFlow?.ivRegime;
  const topStrategy = payload.recommendedStrategies[0];
  const strike = payload.exactStrikeRecommendation;
  const ready = payload.tradeGuidance.shouldConsiderTrade;

  const readsBlock = joinTelegramLines(
    priceActionLine(pa.action, pa.confidence),
    optionRead(payload.optionFlow?.bias, payload.action),
    iv ? `🌡 IV: ${escapeHtml(iv)}` : null,
  );

  const recBlock = joinTelegramLines(
    tradeHeadline(payload.action),
    `<b>${escapeHtml(label)}</b> · ${payload.tradingStyle} · ${tradeActionLabel(payload.action)}`,
    `💰 Spot ${payload.lastPrice.toLocaleString('en-IN')} · ${biasEmoji(payload.bias)} ${escapeHtml(payload.bias)} · ${payload.conviction}% conviction`,
    readsBlock,
    ready ? '✅ Meets enter bar' : '⚠️ Below enter bar — wait or size down',
    strike
      ? `🎯 <code>${escapeHtml(strike.fyersSymbol)}</code> · ${strike.moneyness} @ ${strike.strike.toLocaleString('en-IN')}`
      : payload.action === 'CE-BUY' || payload.action === 'PE-BUY'
        ? 'No strike pick — chain data thin'
        : null,
    topStrategy
      ? `🎲 Top playbook: <b>${escapeHtml(topStrategy.strategy)}</b>${topStrategy.confidenceScore != null ? ` · ${topStrategy.confidenceScore}%` : ''}`
      : null,
  );

  return recBlock;
}

export function formatNowTelegramMessage(params: {
  context: NowMarketContext;
  items: TradeDecisionAlertPayload[];
  errors?: Array<{ symbol: string; tradingStyle: TradingStyle; error: string }>;
}): string {
  const watchBlocks = params.items.map((item) => formatNowWatchItem(item));
  const errorBlock =
    params.errors && params.errors.length > 0
      ? joinTelegramLines(
          '⚠️ Could not load:',
          ...params.errors.map(
            (e) =>
              `• ${shortSymbol(e.symbol)} · ${e.tradingStyle}: ${escapeHtml(e.error)}`,
          ),
        )
      : null;

  return joinTelegramSections(
    formatNowMarketContextBlock(params.context),
    ...watchBlocks,
    errorBlock,
    '<i>On-demand snapshot — not an alert. Detail: <code>/why live</code></i>',
  );
}