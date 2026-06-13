import {
  buildPaDrilldown,
  buildPaDrilldownFromTimelinePoint,
} from './deck-pa-drilldown';
import { TimelinePoint } from '../types/technical-analysis';

describe('deck-pa-drilldown', () => {
  it('builds per-TF, confluence, and gate sections', () => {
    const drilldown = buildPaDrilldown({
      primaryTimeframe: '15m',
      timeframeScores: { '5m': 0.2, '15m': 0.15, '1h': 0.42 },
      mtfScore: 0.28,
      aligned: 3,
      higherTfSupport: true,
      adx: { '5m': 18, '15m': 22, '1h': 24 },
      atr: { '5m': 12, '15m': 28, '1h': 55 },
      momentum: { recent: { '5m': 0.1, '15m': 0.05, '1h': 0.2 } },
      structureElements: {
        fvg: {
          '5m': [{ type: 'bullish' }],
          '15m': [],
          '1h': [],
        },
        orderBlocks: {
          '5m': [],
          '15m': [{ type: 'bearish' }],
          '1h': [],
        },
      },
      signal: {
        action: 'NO-TRADE',
        confidence: 12,
        vetoReason: 'Soft ADX chop',
      },
    });

    expect(drilldown.sections.some((s) => s.id === 'tf-15m')).toBe(true);
    expect(drilldown.sections.find((s) => s.id === 'tf-15m')?.title).toContain('primary');
    expect(
      drilldown.sections.find((s) => s.id === 'confluence')?.rows.some((r) => r.value === '3/3'),
    ).toBe(true);
    expect(
      drilldown.sections
        .find((s) => s.id === 'signal-gates')
        ?.rows.some((r) => r.label === 'Veto reason'),
    ).toBe(true);
  });

  it('builds from timeline point with structure elements', () => {
    const point = {
      asOf: Date.now(),
      asOfISO: new Date().toISOString(),
      spot: 25000,
      primaryTimeframe: '15m',
      timeframeScores: { '5m': 0.1, '15m': 0.2, '1h': 0.3 },
      mtfScore: 0.22,
      aligned: 3,
      signal: { action: 'NO-TRADE', confidence: 10, strength: 'LOW' },
      momentum: {
        recent: { '5m': 0, '15m': 0.1, '1h': 0.05 },
        adx: { '5m': 14, '15m': 16, '1h': 20 },
      },
      atr: { '5m': 10, '15m': 20, '1h': 40 },
      structureElements: {
        fvg: { '5m': [], '15m': [], '1h': [] },
        orderBlocks: { '5m': [], '15m': [], '1h': [] },
      },
      levels: { support: 24900, resistance: 25100 },
      tradeOutcome: { status: 'NO-TRADE', pnlR: 0, barsHeld: 0 },
      outcomeVsEnd: { pnl: 0, pnlPercent: 0 },
    } as TimelinePoint;

    const drilldown = buildPaDrilldownFromTimelinePoint(point);
    expect(drilldown.sections.find((s) => s.id === 'levels')).toBeTruthy();
    expect(drilldown.sections.find((s) => s.id === 'tf-1h')?.rows.length).toBeGreaterThan(1);
  });
});