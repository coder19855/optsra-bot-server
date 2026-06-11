import { formatTelegramAlertMessage } from './message-formatter';
import { SignalSnapshot } from '../types/telegram-notifications';
import { TradingStyle } from '../types/trading-style';
import { buildSignalSnapshot } from './signal-tracker';

function minimalPayload(
  overrides: Partial<Parameters<typeof formatTelegramAlertMessage>[0]['payload']> = {},
) {
  return {
    symbol: 'NSE:NIFTY50-INDEX',
    tradingStyle: TradingStyle.Intraday,
    lastPrice: 25000,
    action: 'NO-TRADE' as const,
    bias: 'Moderate Bearish' as const,
    conviction: 21,
    recommendation: 'Wait',
    humanSummary: 'Bearish context, no entry',
    tradeGuidance: {
      shouldConsiderTrade: false,
      sizeRecommendation: 'Below style threshold',
    },
    priceAction: {
      action: 'NO-TRADE' as const,
      confidence: 0,
    },
    recommendedStrategies: [],
    ...overrides,
  };
}

function minimalSnapshot(action: SignalSnapshot['action']): SignalSnapshot {
  return buildSignalSnapshot(
    minimalPayload({
      action,
      bias: action === 'PE-BUY' ? 'Strong Bearish' : 'Moderate Bearish',
      conviction: action === 'PE-BUY' ? 62 : 21,
      tradeGuidance: {
        shouldConsiderTrade: action !== 'NO-TRADE',
      },
      priceAction: {
        action: action === 'NO-TRADE' ? 'NO-TRADE' : action,
        confidence: action === 'NO-TRADE' ? 0 : 58,
      },
    }),
  );
}

describe('formatTelegramAlertMessage', () => {
  it('shows momentum-decay copy when PA confidence is 0 on NO-TRADE', () => {
    const message = formatTelegramAlertMessage({
      payload: minimalPayload(),
      previous: minimalSnapshot('PE-BUY'),
      current: minimalSnapshot('NO-TRADE'),
      kinds: ['ACTION'],
    });

    expect(message).toContain('Entry veto');
    expect(message).toContain('Chart vetoed — momentum decay');
    expect(message).not.toContain('Price action: NO-TRADE · 0%');
  });

  it('shows a normal PA confidence line for actionable reads', () => {
    const message = formatTelegramAlertMessage({
      payload: minimalPayload({
        action: 'PE-BUY',
        bias: 'Strong Bearish',
        conviction: 62,
        tradeGuidance: { shouldConsiderTrade: true },
        priceAction: { action: 'PE-BUY', confidence: 58 },
      }),
      previous: minimalSnapshot('NO-TRADE'),
      current: minimalSnapshot('PE-BUY'),
      kinds: ['ACTION'],
    });

    expect(message).toContain('PE-BUY (bearish) · 58%');
  });

  it('shows veto copy when PA is PE-BUY with 0% confidence', () => {
    const message = formatTelegramAlertMessage({
      payload: minimalPayload({
        priceAction: {
          action: 'PE-BUY',
          confidence: 0,
          structuralAction: 'PE-BUY',
          confidenceBeforeDecay: 62,
        },
      }),
      previous: minimalSnapshot('PE-BUY'),
      current: minimalSnapshot('NO-TRADE'),
      kinds: ['ACTION'],
    });

    expect(message).toContain('Entry veto');
    expect(message).toContain('PE setup was on the table');
    expect(message).toContain('was 62% before decay');
    expect(message).not.toContain('PE-BUY (bearish) · 0%');
  });

  it('includes the was → now change line on exit', () => {
    const message = formatTelegramAlertMessage({
      payload: minimalPayload(),
      previous: minimalSnapshot('PE-BUY'),
      current: minimalSnapshot('NO-TRADE'),
      kinds: ['ACTION'],
    });

    expect(message).toContain('Was Buy Put (PE) → now No trade');
  });

  it('shows caution headline without was → now on EDGE_FADE', () => {
    const message = formatTelegramAlertMessage({
      payload: minimalPayload(),
      previous: minimalSnapshot('PE-BUY'),
      current: minimalSnapshot('NO-TRADE'),
      kinds: ['EDGE_FADE'],
      alertTone: 'caution',
      exitReason:
        'Setup cooled off — edge fading. Hold unless stop hits; wait for hard exit confirmation.',
    });

    expect(message).toContain('edge fading');
    expect(message).not.toContain('Was Buy Put (PE) → now No trade');
  });

  it('shows hard exit headline and reason on HARD_EXIT', () => {
    const message = formatTelegramAlertMessage({
      payload: minimalPayload(),
      previous: minimalSnapshot('PE-BUY'),
      current: minimalSnapshot('NO-TRADE'),
      kinds: ['HARD_EXIT'],
      alertTone: 'hard_exit',
      exitReason: 'Index stop breached (spot 25,100)',
    });

    expect(message).toContain('Index stop breached');
    expect(message).not.toContain('Was Buy Put (PE) → now No trade');
  });

  it('uses tapori voice for PE entry headlines', () => {
    const message = formatTelegramAlertMessage({
      payload: minimalPayload({
        action: 'PE-BUY',
        bias: 'Strong Bearish',
        conviction: 62,
        tradeGuidance: { shouldConsiderTrade: true },
        priceAction: { action: 'PE-BUY', confidence: 58 },
      }),
      previous: minimalSnapshot('NO-TRADE'),
      current: minimalSnapshot('PE-BUY'),
      kinds: ['ACTION'],
      voice: 'tapori',
    });

    expect(message).toContain('PUT pakad');
    expect(message).toContain('Pehle');
  });

  it('uses marathi voice for edge fade cautions', () => {
    const message = formatTelegramAlertMessage({
      payload: minimalPayload(),
      previous: minimalSnapshot('PE-BUY'),
      current: minimalSnapshot('NO-TRADE'),
      kinds: ['EDGE_FADE'],
      alertTone: 'caution',
      exitReason:
        'Setup cooled off — edge fading. Hold unless stop hits; wait for hard exit confirmation.',
      voice: 'marathi',
    });

    expect(message).toContain('thanda hotoy');
    expect(message).toContain('Stop na lagla');
  });
});