import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { ScoreComponents } from '../fastify';
import { Focus } from '../types';

export default fp(
  async (fastify: FastifyInstance) => {
    const getInterp = (val: number | null, fn: (v: number) => string) =>
      val === null ? 'Data Unavailable' : fn(val);

    const explainOI = (value: number) => {
      return {
        name: 'OI Pressure Score',
        score: value,
        meaning:
          'Measures intraday change in Open Interest. Rising Put OI below spot is bullish; rising Call OI above spot is bearish.',
        interpretation: getInterp(value, fastify.utilsPlugin.interpretRange),
        weightage: 23,
        focus: Focus.Intraday,
      };
    };

    const explainPCR = (value: number) => {
      return {
        name: 'PCR Score',
        score: value,
        meaning:
          'Normalized Put‑Call Ratio sentiment indicator (Overall).Positive score means put OI is higher than call OI (bullish).Negative score means call OI is higher than put OI (bearish). Score is centered at 0 (PCR = 1)',
        interpretation: getInterp(value, fastify.utilsPlugin.interpretRange),
        weightage: 12,
        focus: Focus.Overall,
      };
    };

    const explainSkew = (value: number | null) => {
      return {
        name: 'IV Skew Score',
        score: value,
        meaning:
          'Measures fear vs greed. Higher put IV indicates downside fear; higher call IV indicates upside chase.',
        interpretation: getInterp(value, fastify.utilsPlugin.interpretRange),
        weightage: 12,
        focus: Focus.Overall,
      };
    };

    const explainIV = (value: number | null) => {
      return {
        name: 'ATM IV Score',
        score: value,
        meaning:
          'Measures volatility regime at-the-money. Low IV favors buying options; high IV favors selling options.',
        interpretation: getInterp(value, fastify.utilsPlugin.interpretIVRange),
        weightage: 12,
        focus: Focus.Intraday,
      };
    };

    const explainMaxPain = (value: number) => {
      return {
        name: 'Max Pain Score',
        score: value,
        meaning:
          'Measures expiry magnet effect. Closer to max pain means more sideways/pinning behavior.',
        interpretation: fastify.utilsPlugin.interpretRange(value),
        weightage: 12,
        focus: Focus.Overall,
      };
    };

    const explainGreeks = (value: number | null) => {
      return {
        name: 'Greeks Composite Score',
        score: value,
        meaning:
          'Dealer behavior model combining Delta, Gamma, Vega, and Theta.',
        interpretation: getInterp(value, fastify.utilsPlugin.interpretRange),
        weightage: 16,
        focus: Focus.Intraday,
      };
    };

    const explainVix = (vixValue: number, vixScore: number) => {
      return {
        name: 'India VIX Score',
        value: vixValue,
        score: vixScore,
        meaning:
          'India VIX measures expected volatility for the next 30 days. High VIX means fear and expensive options; low VIX means calm markets and cheap options.',
        interpretation: fastify.utilsPlugin.interpretVixRange(vixValue),
        weightage: 5,
        focus: Focus.Overall,
      };
    };

    const explainTrend = (value: number) => {
      return {
        name: 'Trend Confirmation Score',
        score: value,
        interpretation: getInterp(value, fastify.utilsPlugin.interpretRange),
        meaning:
          'Bullish if price and OI increases or Price increase and OI decreases otherwise Bearish.',
        weightage: 8,
        focus: Focus.Overall,
      };
    };

    const buildExplanations = (
      components: ScoreComponents,
      vixValue: number,
    ) => {
      return {
        oi: explainOI(components.oi),
        pcr: explainPCR(components.pcr),
        skew: explainSkew(components.skew),
        iv: explainIV(components.iv),
        pain: explainMaxPain(components.pain),
        greeks: explainGreeks(components.greeks),
        vix: explainVix(vixValue, components.vix),
        trend: explainTrend(components.trend),
      };
    };

    fastify.decorate('explanationPlugin', {
      buildExplanations,
    });
  },
  { name: 'explanationPlugin' },
);
