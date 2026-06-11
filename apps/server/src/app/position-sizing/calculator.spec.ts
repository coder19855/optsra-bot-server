import { TradingStyle } from '../types/trading-style';
import {
  calculatePositionSizing,
  clampRiskPercent,
  confidenceRiskMultiplier,
  extractAvailableBalance,
  resolveBaseRiskPercent,
} from './calculator';

describe('position-sizing calculator', () => {
  describe('extractAvailableBalance', () => {
    it('reads available balance row', () => {
      const result = extractAvailableBalance([
        { title: 'Available Balance', equityAmount: 50000 },
        { title: 'Total Balance', equityAmount: 55000 },
      ]);
      expect(result.available).toBe(50000);
      expect(result.total).toBe(55000);
    });

    it('falls back to total then first row', () => {
      expect(
        extractAvailableBalance([
          { title: 'Total Balance', equityAmount: 40000 },
        ]).available,
      ).toBe(40000);
      expect(
        extractAvailableBalance([{ title: 'Other', equityAmount: 1000 }])
          .available,
      ).toBe(1000);
    });
  });

  describe('confidenceRiskMultiplier', () => {
    it('scales by confidence bands', () => {
      expect(confidenceRiskMultiplier(80)).toBe(1);
      expect(confidenceRiskMultiplier(60)).toBe(0.75);
      expect(confidenceRiskMultiplier(40)).toBe(0.5);
      expect(confidenceRiskMultiplier(20)).toBe(0);
    });
  });

  describe('clampRiskPercent / resolveBaseRiskPercent', () => {
    it('clamps risk within min/max', () => {
      expect(clampRiskPercent(0.1)).toBe(0.25);
      expect(clampRiskPercent(5)).toBe(2.5);
      expect(clampRiskPercent(1.2)).toBe(1.2);
    });

    it('uses style default when override missing', () => {
      expect(resolveBaseRiskPercent(TradingStyle.Scalper)).toBe(0.75);
      expect(resolveBaseRiskPercent(TradingStyle.Intraday)).toBe(1);
      expect(resolveBaseRiskPercent(TradingStyle.Positional)).toBe(1.5);
    });

    it('honours valid override', () => {
      expect(resolveBaseRiskPercent(TradingStyle.Intraday, 1.8)).toBe(1.8);
    });
  });

  describe('calculatePositionSizing', () => {
    it('computes risk-based lots without premium', () => {
      const result = calculatePositionSizing({
        availableBalance: 100000,
        riskPercent: 1,
        riskPoints: 50,
        lotSize: 25,
        delta: 0.5,
      });
      expect(result.recommendedLots).toBeGreaterThan(0);
      expect(result.maxLotsByMargin).toBeNull();
      expect(result.tiers).toHaveLength(3);
      expect(result.notes.some((n) => n.includes('risk-only'))).toBe(true);
    });

    it('caps lots by margin when premium is provided', () => {
      const result = calculatePositionSizing({
        availableBalance: 100000,
        riskPercent: 1,
        riskPoints: 30,
        lotSize: 25,
        delta: 0.5,
        premium: 200,
      });
      expect(result.maxLotsByMargin).not.toBeNull();
      expect(result.recommendedLots).toBeLessThanOrEqual(
        result.maxLotsByRisk,
      );
      expect(result.marginRequiredInr).toBeGreaterThan(0);
    });

    it('returns zero lots when risk budget is too small', () => {
      const result = calculatePositionSizing({
        availableBalance: 1000,
        riskPercent: 0.25,
        riskPoints: 200,
        lotSize: 50,
        delta: 0.5,
      });
      expect(result.recommendedLots).toBe(0);
      expect(result.notes.some((n) => n.includes('too small'))).toBe(true);
    });
  });
});