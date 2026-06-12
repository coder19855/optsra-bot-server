import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { getStyleScoringConfig } from '../constants/trading-style';
import { TradingStyle } from '../types/trading-style';
import {
  OptionMetricsResponse,
  PriceActionResponse,
  TradeDecisionResult,
} from '../types';
import {
  FlowMode,
  isOptionOnlyFlow,
  isPaOnlyFlow,
  isSingleSourceFlow,
} from '../types/flow-mode';
import { isVetoOff, VetoMode } from '../types/veto-mode';

export interface DecisionEngineOptions {
  vetoMode?: VetoMode;
  /** @deprecated use vetoMode */
  vetoOff?: boolean;
  flowMode?: FlowMode;
  /** @deprecated use flowMode */
  optionFlowOff?: boolean;
}

export default fp(
  async (fastify: FastifyInstance) => {
    const {
      computeMomentumDecay,
      applyMomentumDecay,
      countDirectionalStructure,
    } = fastify.momentumDecayPlugin;
    // Core brain logic moved here for maintainability
    function computeConfluentDecision(
      price: PriceActionResponse,
      option: OptionMetricsResponse,
      style: TradingStyle,
      options?: DecisionEngineOptions,
    ): TradeDecisionResult {
      const vetoMode: VetoMode =
        options?.vetoMode ?? (options?.vetoOff ? 'off' : 'strict');
      const vetoOff = isVetoOff(vetoMode);
      const vetoRelaxed = vetoMode === 'relaxed';
      const flowMode: FlowMode =
        options?.flowMode ??
        (options?.optionFlowOff ? 'pa-only' : 'blend');
      const paOnlyFlow = isPaOnlyFlow(flowMode);
      const optionOnlyFlow = isOptionOnlyFlow(flowMode);
      const singleSourceFlow = isSingleSourceFlow(flowMode);
      // Use per-TF primary scoring from the evolved PA engine (style-aware)
      // Primary TF score drives conviction for the chosen style.
      // Alignment is now count of TFs agreeing with primary.
      // Higher TF is confirmation only.
      const tf = (price as any).timeframeScores || {};
      let primaryScore = 0;
      let primaryTF = '15m';
      const allTFs = [tf['5m'] ?? 0, tf['15m'] ?? 0, tf['1h'] ?? 0];

      if (style === TradingStyle.Scalper) {
        primaryTF = '5m';
        primaryScore = tf['5m'] ?? 0;
      } else if (style === TradingStyle.Positional) {
        primaryTF = '1h';
        primaryScore = tf['1h'] ?? 0;
      } else {
        primaryTF = '15m';
        primaryScore = tf['15m'] ?? 0;
      }

      // Alignment: number of TFs with same sign as primary (new logic)
      const primarySign = Math.sign(primaryScore);
      let alignedCount = 0;
      allTFs.forEach(s => {
        if (primarySign === 0 || Math.sign(s) === primarySign) alignedCount++;
      });

      // Higher TF confirmation (1h supports primary) - confirmation only, not part of core conviction
      const h1 = tf['1h'] ?? 0;
      const higherTFConfirm = (primaryTF === '1h') || (Math.sign(h1) === primarySign && Math.abs(h1) > 0.15);

      const isQuiet = Math.abs(primaryScore) < 0.15 || alignedCount <= 1;

      const priceSignal = price.signal.action;
      const priceConf = price.signal.confidence;

      // Conviction driven by primary TF score + style-specific new elements (FVG/OB on primary + ATR/ADX)
      let primaryConviction = Math.min(95, Math.max(0, Math.round(priceConf * 0.8 + Math.abs(primaryScore) * 50)));

      const se2 = price.structureElements || {};
      const priceAtr2 = price.atr || { '5m': 0, '15m': 0, '1h': 0 };
      const priceAdx2 = price.adx || { '5m': 0, '15m': 0, '1h': 0 };
      const priceMomentum = price.momentum || {};

      const structureDirection: 'bullish' | 'bearish' | 'neutral' =
        priceSignal === 'CE-BUY'
          ? 'bullish'
          : priceSignal === 'PE-BUY'
            ? 'bearish'
            : primaryScore > 0.08
              ? 'bullish'
              : primaryScore < -0.08
                ? 'bearish'
                : 'neutral';

      const getTfElements = (tf: '5m' | '15m' | '1h') => ({
        fvgs: (se2.fvg?.[tf] || []) as Array<{ type: 'bullish' | 'bearish' }>,
        obs: (se2.orderBlocks?.[tf] || []) as Array<{
          type: 'bullish' | 'bearish';
        }>,
      });

      const primaryElements =
        primaryTF === '5m'
          ? getTfElements('5m')
          : primaryTF === '1h'
            ? getTfElements('1h')
            : getTfElements('15m');

      const supportiveType =
        structureDirection === 'bearish' ? 'bearish' : 'bullish';
      const opposingType =
        structureDirection === 'bearish' ? 'bullish' : 'bearish';

      const supportiveFvg = countDirectionalStructure(
        primaryElements.fvgs,
        supportiveType,
      );
      const opposingFvg = countDirectionalStructure(
        primaryElements.fvgs,
        opposingType,
      );
      const supportiveOb = countDirectionalStructure(
        primaryElements.obs,
        supportiveType,
      );
      const opposingOb = countDirectionalStructure(
        primaryElements.obs,
        opposingType,
      );

      const primaryAtr =
        primaryTF === '5m'
          ? priceAtr2['5m'] || 0
          : primaryTF === '1h'
            ? priceAtr2['1h'] || 0
            : priceAtr2['15m'] || priceAtr2['5m'] || 0;
      const primaryAdx =
        primaryTF === '5m'
          ? priceAdx2['5m'] || 0
          : primaryTF === '1h'
            ? priceAdx2['1h'] || 0
            : priceAdx2['15m'] || priceAdx2['5m'] || 0;

      primaryConviction += Math.min(8, supportiveFvg * 2.5);
      primaryConviction += Math.min(10, supportiveOb * 2);
      primaryConviction -= Math.min(12, opposingFvg * 3);
      primaryConviction -= Math.min(14, opposingOb * 3);
      if (primaryAtr > 0) primaryConviction += 4;
      if (primaryAdx > 18) primaryConviction += 6;

      const priceConvictionBeforeDecay = Math.min(
        95,
        Math.max(0, Math.round(primaryConviction)),
      );

      const momentumDecayResult = computeMomentumDecay({
        direction: structureDirection,
        score5m: tf['5m'] ?? 0,
        score15m: tf['15m'] ?? 0,
        lastPrice: price.lastPrice,
        resistance: price.levels.resistance,
        support: price.levels.support,
        adx5m: priceAdx2['5m'] || 0,
        adx15m: priceAdx2['15m'] || 0,
        adx1h: priceAdx2['1h'] || 0,
        primaryTF: primaryTF as '5m' | '15m' | '1h',
        structureElements: se2,
        fakeout15m: priceMomentum.fakeout?.['15m'],
        recentMomentum5m: priceMomentum.recent?.['5m'],
        recentMomentum15m: priceMomentum.recent?.['15m'],
      });

      const priceConviction = applyMomentumDecay(
        priceConvictionBeforeDecay,
        momentumDecayResult.decayPercent,
      );

      // Legacy for minimal breakage in rest of function
      const mtfScore = primaryScore;
      const aligned = alignedCount;

      const optionScore = option.score;
      const optionSignal = option.signal;

      const optionConviction = Math.min(
        95,
        Math.max(0, Math.round((Math.abs(optionScore) / 100) * 70 + 20)),
      );

      // Extract components
      const oi = option.components?.oi ?? 0;
      const greeks = option.components?.greeks ?? 0;
      const ivComp = option.components?.iv ?? 0;
      const trend = option.components?.trend ?? 0;
      const pcr = option.components?.pcr ?? 0;
      const skew = option.components?.skew ?? 0;
      const pain = option.components?.pain ?? 0;
      const vixComp = option.components?.vix ?? 0;
      const ivRegime = option.ivRegime || 'Normal IV';

      // Style-aware component strength (as per user feedback on intraday vs positional focus)
      const getStyleAdjustedOptionStrength = () => {
        if (style === TradingStyle.Scalper || style === TradingStyle.Intraday) {
          return oi * 0.35 + greeks * 0.3 + ivComp * 0.2 + trend * 0.15;
        } else {
          return (
            pcr * 0.25 + skew * 0.2 + pain * 0.2 + trend * 0.2 + vixComp * 0.15
          );
        }
      };

      const optionComponentStrength = getStyleAdjustedOptionStrength();

      // Directions
      const priceDirection =
        priceSignal === 'CE-BUY'
          ? 'bullish'
          : priceSignal === 'PE-BUY'
            ? 'bearish'
            : 'neutral';
      const optionDirection =
        optionSignal === 'BULLISH_TRADE'
          ? 'bullish'
          : optionSignal === 'BEARISH_TRADE'
            ? 'bearish'
            : 'neutral';

      const scoringConfig = getStyleScoringConfig(style);
      const { priceActionWeight, optionFlowWeight, convictionThreshold } =
        scoringConfig;

      const tradeDirection = optionOnlyFlow ? optionDirection : priceDirection;

      let blended = paOnlyFlow
        ? priceConviction
        : optionOnlyFlow
          ? optionConviction
          : priceConviction * priceActionWeight +
            optionConviction * optionFlowWeight;

      // Alignment & conflict
      let alignment = 0;
      let conflictLevel: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' = 'NONE';

      if (paOnlyFlow) {
        alignment = aligned >= 2 ? 3 : aligned === 1 ? 2 : 0;
      } else if (optionOnlyFlow) {
        alignment = optionDirection !== 'neutral' ? 3 : 0;
        if (optionComponentStrength > 0.35) blended += 10;
        if (optionComponentStrength < -0.35) blended += 10;
      } else if (priceDirection === optionDirection && priceDirection !== 'neutral') {
        alignment = 3;
        blended += 18;
      } else if (
        priceDirection === 'neutral' ||
        optionDirection === 'neutral'
      ) {
        alignment = 1;
        blended -= 8;
      } else if (vetoOff) {
        alignment = 1;
        blended -= 8;
      } else if (vetoRelaxed) {
        alignment = 0;
        conflictLevel = 'MEDIUM';
        blended -= 16;
      } else {
        alignment = 0;
        conflictLevel = 'HIGH';
        blended -= 28;
      }

      if (!optionOnlyFlow) {
        if (aligned >= 2) {
          alignment += 1;
          blended += 10;
        } else if (aligned === 0) {
          blended -= 15;
        }
        if (higherTFConfirm) blended += 8;
      }

      if (!singleSourceFlow) {
        if (optionComponentStrength > 0.35 && priceDirection === 'bullish')
          blended += 12;
        if (optionComponentStrength < -0.35 && priceDirection === 'bearish')
          blended += 12;
      }

      // ADX for trend strength (benefits all styles, especially when structure is present)
      const priceAdx = (price as any).adx || {};
      if (priceAdx['5m'] > 20 || priceAdx['15m'] > 20 || priceAdx['1h'] > 20) {
        blended += 5; // trend strength bonus
      }

      // Regime adjustments
      if (ivRegime.includes('Expanded') || ivRegime.includes('High IV')) {
        const penalty = style === TradingStyle.Positional ? 12 : 6;
        blended -= penalty;
      }
      if (ivRegime.includes('Crushed') && style !== TradingStyle.Scalper) {
        blended -= 5;
      }

      // Final decision driven by style-weighted blended conviction
      let action: 'CE-BUY' | 'PE-BUY' | 'NEUTRAL' | 'NO-TRADE' = 'NO-TRADE';
      let conviction = Math.min(95, Math.max(0, Math.round(blended)));

      const highThreshold = convictionThreshold.enter;
      const mediumThreshold = convictionThreshold.medium;
      const strongThreshold = convictionThreshold.strong;

      const optionStronglyAgainst =
        singleSourceFlow || vetoOff
          ? false
          : (priceDirection === 'bullish' && optionDirection === 'bearish') ||
            (priceDirection === 'bearish' && optionDirection === 'bullish') ||
            (option.components &&
              ((priceDirection === 'bullish' &&
                (option.components.greeks ?? 0) < -0.5) ||
                (priceDirection === 'bearish' &&
                  (option.components.greeks ?? 0) > 0.5)));

      const structuralGatesOk =
        (vetoOff || vetoRelaxed || conflictLevel !== 'HIGH') &&
        (optionOnlyFlow
          ? optionDirection !== 'neutral'
          : alignedCount > 0) &&
        !optionStronglyAgainst;

      if (
        conviction >= highThreshold &&
        tradeDirection !== 'neutral' &&
        structuralGatesOk
      ) {
        action = tradeDirection === 'bullish' ? 'CE-BUY' : 'PE-BUY';
      } else if (
        conviction >= mediumThreshold &&
        (singleSourceFlow || priceDirection === optionDirection) &&
        tradeDirection !== 'neutral' &&
        structuralGatesOk
      ) {
        action = tradeDirection === 'bullish' ? 'CE-BUY' : 'PE-BUY';
      } else if (conflictLevel === 'HIGH' || alignedCount === 0) {
        const hasNeutralOpportunity =
          (ivRegime.includes('Crushed') || ivRegime.includes('Low IV') || isQuiet) &&
          (optionScore > 5 || Math.abs(optionComponentStrength) > 0.12);

        if (hasNeutralOpportunity) {
          action = 'NEUTRAL';
          conviction = Math.min(65, Math.max(25, Math.round(optionConviction * 0.7 + (ivRegime.includes('Crushed') ? 18 : 0))));
        } else {
          action = 'NO-TRADE';
        }
      }

      if (style !== TradingStyle.Scalper && optionStronglyAgainst) {
        action = 'NO-TRADE';
      }

      if (action !== 'NO-TRADE' && action !== 'NEUTRAL' && isQuiet && (ivRegime.includes('Crushed') || ivRegime.includes('Low IV')) && conviction < 55) {
        action = 'NEUTRAL';
        conviction = Math.max(conviction, 35);
      }

      const hasWeakOverrideSignal = optionOnlyFlow
        ? optionConviction >= highThreshold
        : paOnlyFlow
          ? priceConviction >= highThreshold
          : style === TradingStyle.Positional
            ? optionConviction >= highThreshold && priceConviction > 25
            : style === TradingStyle.Scalper
              ? priceConviction >= strongThreshold && optionConviction > 15
              : priceConviction >= highThreshold && optionConviction > 30;

      if (
        action === 'NO-TRADE' &&
        hasWeakOverrideSignal &&
        structuralGatesOk
      ) {
        action = tradeDirection === 'bullish' ? 'CE-BUY' : 'PE-BUY';
        conviction = Math.min(mediumThreshold, conviction);
      }

      // Momentum-aware score: when structure lags, recent candles + 5m lead the bias label
      const recent5 = priceMomentum.recent?.['5m'] ?? 0;
      const recent15 = priceMomentum.recent?.['15m'] ?? 0;
      const recent1h = priceMomentum.recent?.['1h'] ?? 0;
      const momentumAwareScore =
        primaryTF === '5m'
          ? primaryScore * 0.4 + recent5 * 0.6
          : primaryTF === '15m'
            ? primaryScore * 0.35 + recent15 * 0.5 + (tf['5m'] ?? 0) * 0.15
            : primaryScore * 0.4 + recent1h * 0.6;

      const useMomentumBias =
        action === 'NO-TRADE' ||
        action === 'NEUTRAL' ||
        conviction < highThreshold ||
        momentumDecayResult.decayPercent >= 0.3;
      const biasScore = useMomentumBias ? momentumAwareScore : primaryScore;

      let bias: 'Strong Bullish' | 'Moderate Bullish' | 'Neutral' | 'Moderate Bearish' | 'Strong Bearish' = 'Neutral';

      if (biasScore > 0.25 && conviction >= highThreshold && !optionStronglyAgainst) {
        bias = 'Strong Bullish';
      } else if (biasScore > 0.1 && conviction >= mediumThreshold && !optionStronglyAgainst) {
        bias = 'Moderate Bullish';
      } else if (biasScore < -0.25 && conviction >= highThreshold && !optionStronglyAgainst) {
        bias = 'Strong Bearish';
      } else if (biasScore < -0.1 && conviction >= mediumThreshold && !optionStronglyAgainst) {
        bias = 'Moderate Bearish';
      } else if (
        useMomentumBias &&
        momentumDecayResult.decayPercent >= 0.35
      ) {
        if (momentumAwareScore < -0.2) bias = 'Moderate Bearish';
        else if (momentumAwareScore > 0.2) bias = 'Moderate Bullish';
        else bias = 'Neutral';
      } else if (Math.abs(biasScore) < 0.1) {
        bias = 'Neutral';
      } else if (biasScore > 0) {
        bias = 'Moderate Bullish';
      } else {
        bias = 'Moderate Bearish';
      }

      const humanSummary = generateHumanSummary(
        action,
        conviction,
        price,
        option,
        style,
        conflictLevel,
        aligned,
        higherTFConfirm,
      );

      const reasons = {
        bullish: [] as string[],
        bearish: [] as string[],
        neutral: [] as string[],
      };

      if (priceDirection === 'bullish')
        reasons.bullish.push(
          `Price action bullish on ${price.primaryTimeframe} (score ${mtfScore.toFixed(2)})`,
        );
      if (priceDirection === 'bearish')
        reasons.bearish.push(
          `Price action bearish on ${price.primaryTimeframe}`,
        );
      if (optionDirection === 'bullish')
        reasons.bullish.push(
          `Option flow bullish (score ${optionScore.toFixed(0)})`,
        );
      if (optionDirection === 'bearish')
        reasons.bearish.push(
          `Option flow bearish (score ${optionScore.toFixed(0)})`,
        );

      const isIntradayStyle =
        style === TradingStyle.Scalper || style === TradingStyle.Intraday;
      if (isIntradayStyle) {
        if (oi > 0.3)
          reasons.bullish.push(
            'Strong bullish OI pressure near spot (intraday flow)',
          );
        if (oi < -0.3)
          reasons.bearish.push(
            'Strong bearish OI pressure near spot (intraday flow)',
          );
        if (greeks > 0.25)
          reasons.bullish.push(
            'Favorable greeks/dealer positioning for bullish (intraday)',
          );
        if (greeks < -0.25)
          reasons.bearish.push(
            'Unfavorable greeks/dealer positioning (intraday)',
          );
      } else {
        if (pcr > 0.25)
          reasons.bullish.push('Bullish PCR (structural sentiment)');
        if (pcr < -0.25)
          reasons.bearish.push('Bearish PCR (structural sentiment)');
        if (pain !== 0)
          reasons.neutral.push(
            'Max pain effect present (positional pinning consideration)',
          );
      }

      if (higherTFConfirm)
        reasons.bullish.push('Higher timeframe structure confirms');
      if (alignedCount === 0) reasons.neutral.push('No timeframe alignment');
      if (conflictLevel === 'HIGH')
        reasons.neutral.push(
          'Direct conflict between price action and option flow',
        );
      if (action === 'NEUTRAL')
        reasons.neutral.push(
          'Market conditions favor neutral / range-bound or volatility strategies over directional ones.',
        );

      // Risk
      const riskNotes: string[] = [];
      let suggestedRisk = 0.5;

      if (action !== 'NO-TRADE') {
        const isNeutralTrade = action === 'NEUTRAL';
        const stopDistance = Math.abs(
          price.lastPrice -
            (priceDirection === 'bullish'
              ? price.levels.support
              : price.levels.resistance),
        );
        const riskPercentOfPrice = (stopDistance / price.lastPrice) * 100;
        const styleLabelForRisk =
          style === TradingStyle.Scalper
            ? 'scalping'
            : style === TradingStyle.Positional
              ? 'positional'
              : 'intraday';

        if (isNeutralTrade) {
          suggestedRisk = style === TradingStyle.Scalper ? 0.5 : 0.4;
          riskNotes.push(
            'Neutral / range-bound strategy recommended. Focus on defined risk structures and IV expansion or time decay.',
          );
          if (ivRegime.includes('Crushed')) {
            riskNotes.push(
              'IV Crushed environment — good for long vega neutral strategies (calendars, diagonals) expecting mean reversion in vol.',
            );
          }
        } else {
          if (riskPercentOfPrice > 0.85) {
            riskNotes.push(
              `Stop distance is ${riskPercentOfPrice.toFixed(2)}% of price — quite wide for ${styleLabelForRisk}. Reduce size significantly.`,
            );
            suggestedRisk = style === TradingStyle.Scalper ? 0.35 : 0.3;
          } else if (riskPercentOfPrice > 0.55) {
            suggestedRisk = style === TradingStyle.Scalper ? 0.6 : 0.5;
          } else {
            suggestedRisk =
              style === TradingStyle.Scalper
                ? 0.8
                : style === TradingStyle.Positional
                  ? 0.55
                  : 0.65;
          }
          if (ivRegime.includes('Expanded') || ivRegime.includes('High IV')) {
            riskNotes.push(
              'IV is elevated — options are expensive. Strongly consider defined-risk spreads over naked long options.',
            );
          }
          if (Math.abs((option as any).spotLtpChangePercent || 0) > 0.6) {
            riskNotes.push(
              'Large move already occurred today — be wary of exhaustion or reversal.',
            );
          }
          if (conviction < highThreshold) {
            riskNotes.push(
              'Overall conviction is below the style entry threshold — size down and be ready to exit quickly if structure breaks.',
            );
          }
        }
      } else {
        riskNotes.push(
          'No trade recommended due to low confluence or conflict between sources.',
        );
        suggestedRisk = 0;
      }

      const recommendation =
        bias === 'Neutral'
          ? 'NEUTRAL / RANGE - Consider neutral structures or wait for better confluence'
          : conviction >= strongThreshold
            ? `${bias.toUpperCase()} - Strong setup, consider entering with normal size`
            : conviction >= highThreshold
              ? `${bias.toUpperCase()} - Moderate setup, enter with reduced size`
              : `${bias.toUpperCase()} - Weak setup, only if you have high personal tolerance and other confluence`;

      // Strategy selection
      const rawStrategies = option.strategies || [];
      const recommendedStrategies = selectRecommendedStrategies(
        rawStrategies,
        action,
        conviction,
        price,
        option,
        style,
        ivRegime,
      );

      return {
        bias,
        action,  // legacy - still used internally for strategy selection path (will be removed later)
        conviction,
        recommendation,
        humanSummary,
        priceConviction,
        priceConvictionBeforeDecay,
        momentumDecay: momentumDecayResult,
        optionConviction,
        alignment,
        conflictLevel,
        risk: { suggestedRiskPercent: suggestedRisk, notes: riskNotes },
        reasons,
        recommendedStrategies,
      };
    }

    function selectRecommendedStrategies(
      rawStrategies: any[],
      action: 'CE-BUY' | 'PE-BUY' | 'NEUTRAL' | 'NO-TRADE',
      conviction: number,
      price: PriceActionResponse,
      option: OptionMetricsResponse,
      style: TradingStyle,
      ivRegime: string,
    ) {
      if (
        action === 'NO-TRADE' ||
        action === 'NEUTRAL' ||
        rawStrategies.length === 0
      ) {
        return rawStrategies
          .filter((s: any) => {
            const strat = (s.strategy || '').toLowerCase();
            return (
              strat.includes('condor') ||
              strat.includes('butterfly') ||
              strat.includes('straddle') ||
              strat.includes('strangle') ||
              strat.includes('calendar') ||
              strat.includes('iron')
            );
          })
          .slice(0, 4)
          .map((s: any) => ({
            ...s,
            suitability:
              action === 'NEUTRAL'
                ? 'Neutral / range-bound conditions detected (quiet price action + favorable IV). These strategies suit low directional conviction environments.'
                : 'Market lacks clear directional confluence. Neutral/range strategies may perform better in low conviction environments.',
            recommendedFor:
              action === 'NEUTRAL'
                ? 'Neutral / low-vol / IV expansion'
                : 'Low conviction / ranging conditions',
          }));
      }

      const isBullish = action === 'CE-BUY';
      const isScalper = style === TradingStyle.Scalper;
      const isPositional = style === TradingStyle.Positional;
      const isIntradayStyle =
        style === TradingStyle.Scalper || style === TradingStyle.Intraday;

      const mtf = price.confluence.mtfScore;
      const alignedCount = price.confluence.aligned;
      const isTrending = Math.abs(mtf) > 0.25 && alignedCount >= 2;
      const isQuiet = Math.abs(mtf) < 0.15 || alignedCount <= 1;

      const isHighIV =
        ivRegime.includes('Expanded') ||
        ivRegime.includes('High IV') ||
        ivRegime.includes('Fear');
      const isLowIV =
        ivRegime.includes('Crushed') || ivRegime.includes('Low IV');

      const compOi = option.components?.oi ?? 0;
      const compGreeks = option.components?.greeks ?? 0;
      const compIv = option.components?.iv ?? 0;
      const compPcr = option.components?.pcr ?? 0;
      const compPain = option.components?.pain ?? 0;

      const filtered = rawStrategies
        .map((strat: any) => {
          const name = (strat.strategy || '').toLowerCase();
          let score = 0;
          let reason = '';

          const isDirectional =
            !name.includes('condor') &&
            !name.includes('butterfly') &&
            !name.includes('straddle') &&
            !name.includes('strangle') &&
            !name.includes('iron') &&
            !name.includes('calendar');

          if (isBullish) {
            if (
              name.includes('call') ||
              name.includes('bull') ||
              name.includes('synthetic long')
            )
              score += 3;
          } else {
            if (
              name.includes('put') ||
              name.includes('bear') ||
              name.includes('synthetic short')
            )
              score += 3;
          }

          if (isTrending && isDirectional) {
            score += 2;
            reason =
              'Strong price structure and multi-timeframe alignment favor directional strategies. ';
          }
          if (isQuiet && !isDirectional) {
            score += 2.5;
            reason =
              'Price action shows low structure / ranging behavior. Neutral or range-bound strategies are more appropriate. ';
          }
          if (isQuiet && isDirectional && !isScalper) {
            score -= 1.5;
          }

          if (isHighIV) {
            if (
              name.includes('short') ||
              name.includes('credit') ||
              name.includes('condor') ||
              name.includes('iron')
            ) {
              score += 2.5;
              reason +=
                'High IV environment favors premium selling / credit strategies. ';
            } else if (name.includes('long') && !isScalper) {
              score -= 1;
            }
          }
          if (isLowIV) {
            if (
              name.includes('long') ||
              name.includes('debit') ||
              name.includes('backspread')
            ) {
              score += 2;
              reason += 'Low IV favors buying premium / debit strategies. ';
            }
          }

          if (isScalper) {
            if (
              name.includes('long call') ||
              name.includes('long put') ||
              name.includes('backspread') ||
              name.includes('synthetic')
            ) {
              score += 1.5;
              reason +=
                'High gamma / quick directional moves suit scalping style. ';
            }
            if (name.includes('condor') || name.includes('calendar'))
              score -= 1;
          }

          if (isPositional) {
            if (
              name.includes('condor') ||
              name.includes('butterfly') ||
              name.includes('calendar') ||
              name.includes('diagonal') ||
              name.includes('iron')
            ) {
              score += 2;
              reason +=
                'Theta-positive or defined-risk structures suit positional holding. ';
            }
            if (
              name.includes('long call') ||
              (name.includes('long put') && conviction < 70)
            )
              score -= 2;
          }

          if (isIntradayStyle) {
            if ((isBullish && compOi > 0.25) || (!isBullish && compOi < -0.25))
              score += 1.2;
            if (
              (isBullish && compGreeks > 0.2) ||
              (!isBullish && compGreeks < -0.2)
            )
              score += 1.0;
            if (compIv > 0.4) score += 0.8;
          } else {
            if ((isBullish && compPcr > 0.2) || (!isBullish && compPcr < -0.2))
              score += 1.0;
            if (Math.abs(compPain) > 0.1) score += 0.6;
          }

          const finalScore = Math.max(0, Math.round(score * 10));

          return {
            ...strat,
            suitabilityScore: finalScore,
            reason:
              reason.trim() ||
              'Selected based on current bias and volatility regime.',
          };
        })
        .sort((a: any, b: any) => b.suitabilityScore - a.suitabilityScore)
        .slice(0, 5);

      if (
        isQuiet &&
        filtered.every((s: any) => {
          const n = (s.strategy || '').toLowerCase();
          return (
            n.includes('long call') ||
            n.includes('long put') ||
            n.includes('synthetic')
          );
        })
      ) {
        const neutralFallback = rawStrategies.find((s: any) => {
          const n = (s.strategy || '').toLowerCase();
          return (
            n.includes('condor') ||
            n.includes('butterfly') ||
            n.includes('iron')
          );
        });
        if (neutralFallback) {
          filtered.push({
            ...neutralFallback,
            suitabilityScore: 55,
            reason:
              'Added as a lower-risk alternative because price action lacks strong trend confirmation.',
          });
        }
      }

      return filtered;
    }

    function generateHumanSummary(
      action: string,
      conviction: number,
      price: PriceActionResponse,
      option: OptionMetricsResponse,
      style: TradingStyle,
      conflictLevel: string,
      aligned: number,
      higherTF: boolean,
    ): string {
      const styleLabel =
        style === TradingStyle.Scalper
          ? 'scalping'
          : style === TradingStyle.Positional
            ? 'positional'
            : 'intraday';
      const tf = price.primaryTimeframe;
      const priceDir =
        price.signal.action === 'CE-BUY'
          ? 'bullish'
          : price.signal.action === 'PE-BUY'
            ? 'bearish'
            : 'neutral';
      const optDir =
        option.signal === 'BULLISH_TRADE'
          ? 'bullish'
          : option.signal === 'BEARISH_TRADE'
            ? 'bearish'
            : 'neutral';

      if (action === 'NO-TRADE') {
        if (conflictLevel === 'HIGH') {
          return `Strong conflict: ${tf} price action is ${priceDir} while option flow is ${optDir}. These two important views disagree significantly. For ${styleLabel} trading, it is safer to stay on the sidelines.`;
        }
        if (aligned === 0) {
          return `The timeframes are not aligned on the ${tf} chart. Price action shows mixed messages (5m: ${price.timeframeScores['5m'].toFixed(2)}, 15m: ${price.timeframeScores['15m'].toFixed(2)}, 1h: ${price.timeframeScores['1h'].toFixed(2)}). Option flow is also not providing clear support. Best to stay patient.`;
        }
        return `Insufficient confluence for a high-quality ${styleLabel} setup on ${tf}. Both price structure and option positioning need to show clearer agreement before committing capital.`;
      }

      if (action === 'NEUTRAL') {
        let neutralSummary = `No strong directional edge for ${styleLabel} on ${tf} (${conviction}% conviction for neutral structures). `;
        if (
          option.ivRegime &&
          (option.ivRegime.includes('Crushed') ||
            option.ivRegime.includes('Low IV'))
        ) {
          neutralSummary +=
            'IV is crushed, making premium cheap — neutral strategies that benefit from IV expansion or time decay (calendars, diagonals, butterflies) are favored. ';
        }
        if (price.confluence.mtfScore < 0.15 || price.confluence.aligned <= 1) {
          neutralSummary +=
            'Price action is quiet with low multi-timeframe alignment, supporting range-bound or non-directional approaches. ';
        }
        neutralSummary +=
          'Focus on defined-risk neutral strategies rather than directional bets.';
        return neutralSummary.trim();
      }

      const directionWord = action === 'CE-BUY' ? 'BULLISH' : 'BEARISH';
      let summary = `${directionWord} setup detected for ${styleLabel} trading on the ${tf} timeframe (${conviction}% conviction). `;

      if (higherTF && aligned >= 2) {
        summary +=
          'Multiple timeframes are aligned and the higher timeframe structure supports the move. ';
      } else if (higherTF) {
        summary +=
          'The higher timeframe is supportive, which adds some weight. ';
      } else if (aligned >= 2) {
        summary += `There is decent multi-timeframe agreement (${aligned}/3 timeframes). `;
      }

      if (priceDir === optDir) {
        summary +=
          'Price action and option flow are pointing in the same direction. ';
      }

      const styleThresholds = getStyleScoringConfig(style).convictionThreshold;
      if (conviction >= styleThresholds.strong) {
        summary +=
          'This is a relatively strong confluence — worth considering with appropriate risk management.';
      } else if (conviction >= styleThresholds.enter) {
        summary +=
          'Conviction meets the style entry threshold but is not overwhelming. Size conservatively and respect your stop.';
      } else {
        summary +=
          'Conviction is below the style entry threshold — only take if other factors (like your own read) are very strong.';
      }

      return summary.trim();
    }

    // Exposed API on fastify
    const decisionEngine = {
      computeTradeDecision: (
        priceData: PriceActionResponse,
        optionData: OptionMetricsResponse,
        style: TradingStyle,
        options?: DecisionEngineOptions,
      ): TradeDecisionResult => {
        return computeConfluentDecision(priceData, optionData, style, options);
      },
    };

    fastify.decorate('decisionEngine', decisionEngine);
  },
  { name: 'decisionEngine', dependencies: ['momentum-decay'] },
);
