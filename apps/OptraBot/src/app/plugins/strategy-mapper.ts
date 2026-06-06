import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import {
  strategyExecutionHints,
  strategyRisk,
  strategyRiskManagement,
  strategyMeta,
} from '../constants';
import {
  Impact,
  IndicatorImpact,
  IndicatorKey,
  IndicatorScores,
  RiskLevel,
  Sentiment,
  Strategy,
  StrategyWithRisk,
} from '../types';

export default fp(async (fastify: FastifyInstance) => {
  const computeImpactForStrategy = (
    strategy: Strategy,
    indicators: IndicatorScores,
  ): { impact: IndicatorImpact; riskScore: number } => {
    const meta = strategyMeta[strategy];
    const biases = fastify.utilsPlugin.getIndicatorBiases(indicators);

    const impact: Partial<IndicatorImpact> = {};
    let riskScore = 0;

    const addImpact = (key: IndicatorKey, value: Impact) => {
      impact[key] = value;
      if (value === 'positive') riskScore -= 1;
      else if (value === 'negative') riskScore += 1;
    };

    // TREND
    if (meta.direction === 'neutral') {
      if (biases.trend === 'neutral') addImpact('trend', 'positive');
      else addImpact('trend', 'negative');
    } else {
      if (biases.trend === meta.direction) addImpact('trend', 'positive');
      else if (biases.trend === 'neutral') addImpact('trend', 'neutral');
      else addImpact('trend', 'negative');
    }

    // IV (your iv score: + = low IV, - = high IV)
    if (meta.premium === 'long') {
      if (biases.iv === 'bullish') addImpact('iv', 'positive');
      else if (biases.iv === 'bearish') addImpact('iv', 'negative');
      else addImpact('iv', 'neutral');
    } else if (meta.premium === 'short') {
      if (biases.iv === 'bearish') addImpact('iv', 'positive');
      else if (biases.iv === 'bullish') addImpact('iv', 'negative');
      else addImpact('iv', 'neutral');
    } else {
      addImpact('iv', 'neutral');
    }

    // VIX
    if (meta.premium === 'long') {
      if (biases.vix === 'bullish') addImpact('vix', 'positive');
      else if (biases.vix === 'bearish') addImpact('vix', 'negative');
      else addImpact('vix', 'neutral');
    } else if (meta.premium === 'short') {
      if (biases.vix === 'bearish') addImpact('vix', 'positive');
      else if (biases.vix === 'bullish') addImpact('vix', 'negative');
      else addImpact('vix', 'neutral');
    } else {
      addImpact('vix', 'neutral');
    }

    // OI PRESSURE
    if (meta.direction === 'bullish') {
      if (biases.oi === 'bullish') addImpact('oi', 'positive');
      else if (biases.oi === 'bearish') addImpact('oi', 'negative');
      else addImpact('oi', 'neutral');
    } else if (meta.direction === 'bearish') {
      if (biases.oi === 'bearish') addImpact('oi', 'positive');
      else if (biases.oi === 'bullish') addImpact('oi', 'negative');
      else addImpact('oi', 'neutral');
    } else {
      addImpact('oi', 'neutral');
    }

    // GREEKS (dealer positioning)
    if (meta.direction === 'bullish') {
      if (biases.greeks === 'bullish') addImpact('greeks', 'positive');
      else if (biases.greeks === 'bearish') addImpact('greeks', 'negative');
      else addImpact('greeks', 'neutral');
    } else if (meta.direction === 'bearish') {
      if (biases.greeks === 'bearish') addImpact('greeks', 'positive');
      else if (biases.greeks === 'bullish') addImpact('greeks', 'negative');
      else addImpact('greeks', 'neutral');
    } else {
      addImpact('greeks', 'neutral');
    }

    // PCR (slow sentiment)
    if (meta.direction === 'bullish') {
      if (biases.pcr === 'bullish') addImpact('pcr', 'positive');
      else if (biases.pcr === 'bearish') addImpact('pcr', 'negative');
      else addImpact('pcr', 'neutral');
    } else if (meta.direction === 'bearish') {
      if (biases.pcr === 'bearish') addImpact('pcr', 'positive');
      else if (biases.pcr === 'bullish') addImpact('pcr', 'negative');
      else addImpact('pcr', 'neutral');
    } else {
      addImpact('pcr', 'neutral');
    }

    // SKEW
    if (meta.direction === 'bullish') {
      if (biases.skew === 'bullish') addImpact('skew', 'positive');
      else if (biases.skew === 'bearish') addImpact('skew', 'negative');
      else addImpact('skew', 'neutral');
    } else if (meta.direction === 'bearish') {
      if (biases.skew === 'bearish') addImpact('skew', 'positive');
      else if (biases.skew === 'bullish') addImpact('skew', 'negative');
      else addImpact('skew', 'neutral');
    } else {
      addImpact('skew', 'neutral');
    }

    // MAX PAIN (pain)
    if (meta.direction === 'neutral') {
      if (biases.pain === 'bullish' || biases.pain === 'bearish') {
        addImpact('pain', 'positive');
      } else {
        addImpact('pain', 'neutral');
      }
    } else {
      if (biases.pain === 'bullish' || biases.pain === 'bearish') {
        addImpact('pain', 'negative');
      } else {
        addImpact('pain', 'neutral');
      }
    }

    return {
      impact: impact as IndicatorImpact,
      riskScore,
    };
  };

  const mapStrategiesWithVix = (
    score: number,
    vix: number,
    indicators: IndicatorScores, // pass your normalized scores here
  ): {
    bias: Sentiment;
    strategies: (StrategyWithRisk & {
      indicatorImpact: IndicatorImpact;
      riskScore: number;
    })[];
    vixRange: string;
  } => {
    const vixRange = fastify.utilsPlugin.interpretVixRange(vix);

    const lowVix = vix <= 16;
    const midVix = vix > 16 && vix <= 20;
    const highVix = vix > 20;

    let bias = Sentiment.Neutral;
    let rawStrategies: Strategy[] = [];

    // STRONG BULLISH
    if (score >= 70) {
      bias = Sentiment.StrongBullish;

      if (lowVix) {
        rawStrategies = [
          Strategy.LongCall,
          Strategy.BullCallSpread,
          Strategy.CallRatioBackSpread,
          Strategy.SyntheticLong,
        ];
      } else if (midVix) {
        rawStrategies = [
          Strategy.BullCallSpread,
          Strategy.CallDiagonal,
          Strategy.BullPutSpread,
          Strategy.BullishBrokenWingButterfly,
        ];
      } else if (highVix) {
        rawStrategies = [
          Strategy.BullPutSpread,
          Strategy.ShortPut,
          Strategy.PutRatioSpread,
          Strategy.JadeLizard,
        ];
      }
    }

    // MODERATE BULLISH
    else if (score >= 40) {
      bias = Sentiment.ModerateBullish;

      if (lowVix) {
        rawStrategies = [
          Strategy.LongCall,
          Strategy.BullCallSpread,
          Strategy.CallDiagonal,
        ];
      } else if (midVix) {
        rawStrategies = [
          Strategy.BullCallSpread,
          Strategy.BullPutSpread,
          Strategy.CallDiagonal,
          Strategy.BullishBrokenWingButterfly,
        ];
      } else if (highVix) {
        rawStrategies = [
          Strategy.BullPutSpread,
          Strategy.ShortPut,
          Strategy.PutRatioSpread,
          Strategy.JadeLizard,
        ];
      }
    }

    // NEUTRAL
    else if (score > -40 && score < 40) {
      bias = Sentiment.Neutral;

      if (lowVix) {
        rawStrategies = [
          Strategy.CalendarSpread,
          Strategy.DiagonalSpread,
          Strategy.LongButterfly,
        ];
      } else if (midVix) {
        rawStrategies = [
          Strategy.CalendarSpread,
          Strategy.IronCondor,
          Strategy.DiagonalSpread,
          Strategy.BrokenWingButterfly,
        ];
      } else if (highVix) {
        rawStrategies = [
          Strategy.IronCondor,
          Strategy.ShortStraddle,
          Strategy.ShortStrangle,
          Strategy.IronButterfly,
          Strategy.BrokenWingButterfly,
        ];
      }
    }

    // MODERATE BEARISH
    else if (score <= -40 && score > -70) {
      bias = Sentiment.ModerateBearish;

      if (lowVix) {
        rawStrategies = [
          Strategy.LongPut,
          Strategy.BearPutSpread,
          Strategy.PutRatioSpread,
        ];
      } else if (midVix) {
        rawStrategies = [
          Strategy.BearPutSpread,
          Strategy.BearCallSpread,
          Strategy.PutRatioSpread,
          Strategy.BearishBrokenWingButterfly,
        ];
      } else if (highVix) {
        rawStrategies = [
          Strategy.BearCallSpread,
          Strategy.ShortCall,
          Strategy.BearishBrokenWingButterfly,
        ];
      }
    }

    // STRONG BEARISH
    else {
      bias = Sentiment.StrongBearish;

      if (lowVix) {
        rawStrategies = [
          Strategy.LongPut,
          Strategy.BearPutSpread,
          Strategy.PutRatioBackSpread,
          Strategy.SyntheticShort,
        ];
      } else if (midVix) {
        rawStrategies = [
          Strategy.BearPutSpread,
          Strategy.BearCallSpread,
          Strategy.BearishBrokenWingButterfly,
        ];
      } else if (highVix) {
        rawStrategies = [
          Strategy.BearCallSpread,
          Strategy.ShortCall,
          Strategy.BearishBrokenWingButterfly,
        ];
      }
    }

    const strategies = rawStrategies.map((s) => {
      const { impact, riskScore } = computeImpactForStrategy(s, indicators);

      return {
        strategy: s,
        risk: strategyRisk[s] ?? RiskLevel.Medium,
        executionHint: strategyExecutionHints[s],
        riskManagement: strategyRiskManagement[s],
        indicatorImpact: impact,
        riskScore,
      };
    });

    return {
      bias,
      strategies,
      vixRange,
    };
  };

  fastify.decorate('strategyMapperPlugin', {
    mapStrategiesWithVix,
    computeImpactForStrategy,
  });
});
