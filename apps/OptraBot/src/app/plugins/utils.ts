import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { Explanation, ScoreComponents } from '../fastify';
import {
  DirectionBias,
  IndicatorKey,
  IndicatorScores,
  TradeSignal,
} from '../types';

export default fp(
  async (fastify: FastifyInstance) => {
    const norm = (x: number, scale = 1) => Math.tanh(x / scale);

    const interpretRange = (value: number) => {
      if (value >= 0.7) return 'Strong Bullish';
      if (value >= 0.4) return 'Moderate Bullish';
      if (value > -0.4) return 'Neutral';
      if (value >= -0.7) return 'Moderate Bearish';
      return 'Strong Bearish';
    };

    const interpretVixRange = (vix: number) => {
      if (vix < 12) return 'Very Low Volatility (Calm)';
      if (vix < 16) return 'Normal Volatility';
      if (vix < 20) return 'Elevated Volatility';
      if (vix < 25) return 'High Volatility (Fear)';
      return 'Very High Volatility (Panic)';
    };

    const interpretIVRange = (ivScore: number) => {
      // +1 → Low IV (cheap options)
      if (ivScore >= 0.6) return 'Low IV (Cheap Options)';

      // +0.2 to +0.6 → Slightly low IV
      if (ivScore >= 0.2) return 'Moderately Low IV (Slightly Cheap Options)';

      // -0.2 to +0.2 → Normal IV
      if (ivScore > -0.2) return 'Normal IV (Neutral Options)';

      // -0.6 to -0.2 → Slightly high IV
      if (ivScore > -0.6)
        return 'Moderately High IV (Slightly Expensive Options)';

      // -1 → High IV (expensive options)
      return 'High IV (Expensive Options)';
    };

    const biasFromScore = (
      score: number | null,
      strong = 0.4,
    ): DirectionBias => {
      if (score === null) return 'neutral';
      if (score >= strong) return 'bullish';
      if (score <= -strong) return 'bearish';
      return 'neutral';
    };

    const getIndicatorBiases = (
      ind: IndicatorScores,
    ): Record<IndicatorKey, DirectionBias> => {
      return {
        oi: biasFromScore(ind.oi),
        pcr: biasFromScore(ind.pcr),
        skew: biasFromScore(ind.skew),
        iv: biasFromScore(ind.iv),
        pain: biasFromScore(ind.pain),
        greeks: biasFromScore(ind.greeks),
        vix: biasFromScore(ind.vix),
        trend: biasFromScore(ind.trend),
      };
    };

    const calcFinalScore = (parts: ScoreComponents): number => {
      const weights: Record<keyof ScoreComponents, number> = {
        oi: 0.23,
        pcr: 0.12,
        skew: 0.12,
        iv: 0.12,
        pain: 0.12,
        greeks: 0.16,
        vix: 0.05,
        trend: 0.08,
      };

      let totalScore = 0;
      let weightApplied = 0;

      for (const [key, weight] of Object.entries(weights)) {
        const value = parts[key as keyof ScoreComponents];

        // FIX: ignore null, undefined, NaN
        if (Number.isFinite(value)) {
          totalScore += (value as number) * weight;
          weightApplied += weight;
        }
      }

      return weightApplied === 0 ? 0 : (totalScore / weightApplied) * 100;
    };

    const mapSignal = (score: number): TradeSignal => {
      let signal = TradeSignal.NonDirectional;
      if (score >= 30) {
        signal = TradeSignal.BullishTrade;
      } else if (score <= -30) {
        signal = TradeSignal.BearishTrade;
      }

      return signal;
    };

    const detectIvRegime = (
      atmIvScore: number,
      vixScore: number,
      skewScore: number,
    ) => {
      // 1) Global IV state (crushed vs expanded)
      if (atmIvScore > 0.3 && vixScore < 0.1) return 'IV Crushed';
      if (atmIvScore < -0.3 && vixScore > 0.2) return 'IV Expanded';

      // 2) Local high/low IV
      if (atmIvScore > 0.1) return 'Low IV';
      if (atmIvScore < -0.1) return 'High IV';

      // 3) Directional skew overlay
      if (Math.abs(skewScore) > 0.2) {
        if (skewScore > 0) return 'Downside IV Elevated (Put Skew)';
        else return 'Upside IV Elevated (Call Skew)';
      }

      // 4) Default
      return 'Normal IV';
    };

    function getIndicatorBias(
      key: string,
      interpretation: string,
    ): 'bullish' | 'bearish' | 'neutral' {
      const text = interpretation.toLowerCase();

      // 1) Generic directional language
      if (
        text.includes('strong bullish') ||
        text.includes('moderate bullish') ||
        text.includes('bullish')
      ) {
        return 'bullish';
      }
      if (
        text.includes('strong bearish') ||
        text.includes('moderate bearish') ||
        text.includes('bearish')
      ) {
        return 'bearish';
      }
      if (
        text.includes('neutral') ||
        text.includes('sideways') ||
        text.includes('range')
      ) {
        return 'neutral';
      }

      // 2) IV-specific logic
      if (key === 'iv') {
        if (text.includes('low iv')) return 'neutral'; // cheap options, but not directional
        if (text.includes('moderately low iv')) return 'neutral';
        if (text.includes('normal iv')) return 'neutral';
        if (text.includes('moderately high iv')) return 'neutral';
        if (text.includes('high iv')) return 'neutral';
      }

      // 3) VIX-specific logic
      if (key === 'vix') {
        if (text.includes('very low volatility')) return 'neutral';
        if (text.includes('normal volatility')) return 'neutral';
        if (text.includes('elevated volatility')) return 'neutral';
        if (text.includes('high volatility') || text.includes('panic'))
          return 'neutral';
      }

      // 4) Fallback: treat unknown phrasing as neutral
      return 'neutral';
    }

    function getSignalBias(
      finalSignal: TradeSignal,
    ): 'bullish' | 'bearish' | 'neutral' {
      const signal = finalSignal.toString().toLowerCase();

      if (signal.includes('bullish')) return 'bullish';
      if (signal.includes('bearish')) return 'bearish';
      if (signal.includes('neutral') || signal.includes('non_directional'))
        return 'neutral';

      return 'neutral';
    }

    function computeConfidence(
      indicators: Record<string, Explanation>,
      finalSignal: TradeSignal,
    ) {
      let totalWeight = 0;
      let matchingWeight = 0;

      const signalBias = getSignalBias(finalSignal);

      for (const key in indicators) {
        const ind = indicators[key];
        const weight = ind.weightage;
        totalWeight += weight;

        const indicatorBias = getIndicatorBias(key, ind.interpretation);

        const matches = indicatorBias === signalBias;

        if (matches) matchingWeight += weight;
      }

      const confidence = totalWeight === 0 ? 0 : matchingWeight / totalWeight;

      return {
        value: confidence,
        percent: Math.round(confidence * 100),
        matchingWeight,
        totalWeight,
      };
    }

    const utilsPlugin = {
      norm,
      interpretRange,
      interpretVixRange,
      interpretIVRange,
      biasFromScore,
      getIndicatorBiases,
      calcFinalScore,
      mapSignal,
      detectIvRegime,
      computeConfidence,
    };

    fastify.decorate('utilsPlugin', utilsPlugin);
  },
  { name: 'utils' },
);
