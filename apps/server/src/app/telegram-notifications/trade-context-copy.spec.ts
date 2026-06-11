import {
  formatTimeframeContextLine,
  formatTradeContextLines,
  formatVetoSection,
} from './trade-context-copy';
import { TradeStructureContext } from '../types/telegram-notifications';

const bearishStack: TradeStructureContext = {
  primaryTimeframe: '15m',
  primaryScore: -0.35,
  timeframeScores: {
    '1h': -0.4,
    '15m': -0.35,
    '5m': -0.3,
  },
  enterThreshold: 60,
};

describe('trade-context-copy', () => {
  it('does not say waiting for trigger when all TFs align bearish but entry is blocked', () => {
    const line = formatTimeframeContextLine(
      'NO-TRADE',
      'Moderate Bearish',
      22,
      bearishStack,
    );

    expect(line).toContain('downtrend');
    expect(line).not.toContain('waiting for trigger');
    expect(line).toContain('stack aligned — blocked (conviction & chart)');
  });

  it('still says waiting for trigger when structure is mixed', () => {
    const line = formatTimeframeContextLine(
      'NO-TRADE',
      'Moderate Bearish',
      22,
      {
        ...bearishStack,
        timeframeScores: {
          '1h': -0.4,
          '15m': -0.35,
          '5m': 0.02,
        },
      },
    );

    expect(line).toContain('waiting for trigger');
  });

  it('includes sidelines and aligned stack copy together', () => {
    const lines = formatTradeContextLines(
      'NO-TRADE',
      'Moderate Bearish',
      22,
      bearishStack,
    );

    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('conviction 22% below 60%');
    expect(lines[1]).toContain('stack aligned — blocked');
  });

  it('formats a veto section when bearish stack is blocked', () => {
    const section = formatVetoSection({
      action: 'NO-TRADE',
      bias: 'Moderate Bearish',
      conviction: 22,
      structureContext: bearishStack,
      priceAction: {
        action: 'NO-TRADE',
        confidence: 0,
        structuralAction: 'PE-BUY',
        confidenceBeforeDecay: 58,
      },
    });

    expect(section).toContain('Entry veto');
    expect(section).toContain('all timeframes downtrend');
    expect(section).toContain('PE was the structural read');
    expect(section).toContain('Conviction 22% below 60%');
    expect(section).toContain('Momentum decay vetoed bearish chart');
    expect(section).toContain('was 58% before decay');
    expect(section).toContain('Stay out until blockers clear');
  });
});