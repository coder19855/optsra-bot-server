import { HttpStatusCode } from 'axios';
import { FastifyInstance } from 'fastify';
import { STYLE_TF_DISPLAY_WEIGHTS } from '../constants/technical-analysis';
import { getStyleScoringConfig, TradingStyle } from '../trading-style';
import { buildExactStrikeRecommendation } from '../option-flow/exact-strike-recommender';
import { GreeksStrikeInsight } from '../types/greeks-strike-insight';
import { ExactStrikeRecommendation } from '../types/exact-strike-recommendation';
import { OptionMetricsResponse, PriceActionResponse } from '../types';

export default async function tradeDecisionRoute(fastify: FastifyInstance) {
  fastify.get('/api/trade-decision', async (request, reply) => {
    const {
      symbol,
      tradingStyle: styleQuery,
      strikeCount,
    } = request.query as {
      symbol: string;
      tradingStyle?: string;
      strikeCount?: number;
    };

    if (!symbol) {
      return reply.code(400).send({ error: 'symbol is required' });
    }

    // Parse trading style
    const styleStr = (styleQuery || 'INTRADAY').toUpperCase();
    let activeStyle = TradingStyle.Intraday;
    if (styleStr === 'SCALPER' || styleStr === TradingStyle.Scalper) {
      activeStyle = TradingStyle.Scalper;
    } else if (
      styleStr === 'POSITIONAL' ||
      styleStr === TradingStyle.Positional
    ) {
      activeStyle = TradingStyle.Positional;
    }

    const styleParam = activeStyle; // SCALPER / INTRADAY / POSITIONAL

    try {
      // Call both existing routes internally (reuses all logic, no duplication)
      const [priceRes, optionRes] = await Promise.all([
        fastify.inject({
          method: 'GET',
          url: `/api/technical-analysis?symbol=${encodeURIComponent(symbol)}&tradingStyle=${styleParam}`,
        }),
        fastify.inject({
          method: 'GET',
          url: `/api/score-metrics?symbol=${encodeURIComponent(symbol)}&tradingStyle=${styleParam}${
            strikeCount ? `&strikeCount=${strikeCount}` : ''
          }`,
        }),
      ]);

      if (priceRes.statusCode !== 200 || optionRes.statusCode !== 200) {
        return reply.code(502).send({
          error: 'Failed to fetch analysis from one or both sources',
          priceStatus: priceRes.statusCode,
          optionStatus: optionRes.statusCode,
        });
      }

      const priceData: PriceActionResponse = JSON.parse(priceRes.body);
      const optionData: OptionMetricsResponse = JSON.parse(optionRes.body);

      // Core logic is now in the decisionEngine plugin (much cleaner route)
      const coreDecision = fastify.decisionEngine.computeTradeDecision(
        priceData,
        optionData,
        activeStyle,
      );

      const scoringConfig = getStyleScoringConfig(activeStyle);

      // Build the clean, explained payload (presentation layer stays light in route)
      // Updated to per-TF primary view (matches the evolved PA engine)
      const primaryTF =
        activeStyle === TradingStyle.Scalper
          ? '5m'
          : activeStyle === TradingStyle.Positional
            ? '1h'
            : '15m';
      const primaryScore =
        (priceData.timeframeScores && priceData.timeframeScores[primaryTF]) ||
        0;

      const confluenceAndDecision = [
        {
          field: 'overallConviction',
          value: coreDecision.conviction,
          explanation:
            coreDecision.conviction === 0
              ? 'Both price action and option flow are showing very low conviction. No strong directional or neutral edge detected.'
              : `Combined conviction ${coreDecision.conviction}% = ${Math.round(scoringConfig.priceActionWeight * 100)}% price action (${coreDecision.priceConviction}%) + ${Math.round(scoringConfig.optionFlowWeight * 100)}% option flow (${coreDecision.optionConviction}%). Primary ${primaryTF} score ${primaryScore.toFixed(2)}.`,
        },
        {
          field: 'priceActionConviction',
          value: coreDecision.priceConviction,
          explanation:
            coreDecision.priceConviction < 20
              ? `Price action on primary ${primaryTF} is extremely weak.`
              : coreDecision.momentumDecay &&
                  coreDecision.momentumDecay.decayPercent > 0
                ? `Price action ${coreDecision.priceConviction}% after momentum decay (was ${coreDecision.priceConvictionBeforeDecay ?? coreDecision.priceConviction}%). ${coreDecision.momentumDecay.reasons.join(' ')}`
                : `Price action on primary ${primaryTF} is contributing ${coreDecision.priceConviction}% (directional FVG/OB + ATR/ADX + structure on ${primaryTF}).`,
        },
        {
          field: 'optionFlowConviction',
          value: coreDecision.optionConviction,
          explanation:
            coreDecision.optionConviction > 25
              ? 'Option flow has some mild positive signals (especially IV regime), but not strong enough for high conviction.'
              : `Option flow conviction is low at ${coreDecision.optionConviction}%.`,
        },
        {
          field: 'alignment',
          value: coreDecision.alignment,
          explanation:
            coreDecision.alignment <= 1
              ? 'Very poor alignment with the primary timeframe.'
              : `${coreDecision.alignment}/3 timeframes aligned with the primary ${primaryTF}.`,
        },
        {
          field: 'conflictLevel',
          value: coreDecision.conflictLevel,
          explanation:
            coreDecision.conflictLevel === 'NONE'
              ? `No direct conflict. Primary ${primaryTF} ${primaryScore > 0.2 ? 'bullish' : primaryScore < -0.2 ? 'bearish' : 'neutral'}, option flow ${coreDecision.optionConviction > 40 ? 'supportive' : 'neutral/weak'}.`
              : 'There is disagreement between the two data sources.',
        },
      ];

      const tfWeights = STYLE_TF_DISPLAY_WEIGHTS[activeStyle];
      const tf5mWeight = tfWeights['5m'];
      const tf15mWeight = tfWeights['15m'];
      const tf1hWeight = tfWeights['1h'];

      const priceActionComponents = {
        '5m': {
          score: priceData.timeframeScores['5m'],
          explanation:
            priceData.timeframeScores['5m'] < -0.2
              ? 'Bearish pressure on the 5-minute chart. Short-term momentum is negative.'
              : '5-minute chart is relatively neutral to positive.',
          weightage: tf5mWeight,
        },
        '15m': {
          score: priceData.timeframeScores['15m'],
          explanation:
            Math.abs(priceData.timeframeScores['15m']) < 0.1
              ? 'Primary 15m timeframe is almost completely flat with no clear direction.'
              : '15-minute chart shows some structure but not strong.',
          weightage: tf15mWeight,
        },
        '1h': {
          score: priceData.timeframeScores['1h'],
          explanation:
            priceData.timeframeScores['1h'] > 0.2
              ? '1-hour timeframe is mildly supportive with some bullish structure.'
              : 'Higher timeframe is not strongly contributing.',
          weightage: tf1hWeight,
        },
        mtfScore: {
          score: priceData.confluence.mtfScore,
          explanation:
            'Overall price action score = 0.2×5m + 0.3×15m + 0.5×1h (fixed calculation). Low value = weak structure across timeframes. The per-TF weightages above are adjusted for your tradingStyle focus.',
          weightage: 1.0,
        },
        alignment: {
          score: priceData.confluence.aligned,
          explanation: `${priceData.confluence.aligned} out of 3 timeframes are aligned in the same direction. 0 alignment is a strong warning sign for any style.`,
          weightage: 0.25, // influence in the decision engine's blended conviction
        },
        higherTFConfirmation: {
          score: priceData.confluence.higherTimeframeConfirmation ? 1 : 0,
          explanation: priceData.confluence.higherTimeframeConfirmation
            ? 'Higher timeframe (1h) structure supports the move (adds bonus to conviction).'
            : 'Higher timeframe does not confirm the lower timeframes (reduces conviction).',
          weightage: 0.15, // influence in the decision engine's blended conviction
        },
      };

      const optionFlowComponents = Object.keys(
        optionData.explanations || {},
      ).map((key) => {
        const exp = (optionData.explanations as any)[key];
        let humanExplanation =
          exp.meaning || 'No detailed explanation available.';

        if (key === 'oi')
          humanExplanation =
            'Shows fresh buying/selling interest through change in open interest. Positive = bulls adding positions below spot.';
        if (key === 'iv')
          humanExplanation =
            'Tells us if options are cheap or expensive right now. High positive score = very cheap options (good for buyers).';
        if (key === 'greeks')
          humanExplanation =
            'Composite view of how dealers are positioned (delta, gamma, vega, theta). Strong negative here means dealers are leaning bearish.';
        if (key === 'trend')
          humanExplanation =
            'Combines recent price move with OI change to confirm if the move has real participation.';
        if (key === 'pcr')
          humanExplanation =
            'Overall market sentiment from total put vs call open interest. Not very directional right now.';
        if (key === 'ivRegime')
          humanExplanation =
            "Current volatility environment. 'IV Crushed' means options are cheap — often good for buying premium or long vol strategies.";

        return {
          name: exp.name || key.toUpperCase(),
          score: exp.score ?? exp.value ?? 0,
          interpretation: exp.interpretation || 'Neutral',
          humanExplanation,
          focus: exp.focus || 'Overall',
          weightage: exp.weightage || 10,
        };
      });

      const finalStrategies = (coreDecision.recommendedStrategies || []).map(
        (strat: any, index: number) => ({
          strategy: strat.strategy,
          risk: strat.risk,
          confidenceScore: strat.suitabilityScore || 80 - index * 10,
          reason:
            strat.reason ||
            strat.suitability ||
            'Selected based on current market regime and style.',
          executionHint: strat.executionHint,
          riskManagement: strat.riskManagement,
        }),
      );

      // If price side gave a clear directional signal with decent confidence, include some matching directional strategies
      // even if the combined brain action is NO-TRADE/NEUTRAL (due to weak option flow). This reduces the "PA strong but only neutral strategies" feeling.
      if (
        priceData.signal &&
        priceData.signal.action !== 'NO-TRADE' &&
        priceData.signal.confidence > 60
      ) {
        const isBull = priceData.signal.action === 'CE-BUY';
        const matching = (optionData.strategies || [])
          .filter((s: any) => {
            const n = (s.strategy || '').toLowerCase();
            return isBull
              ? n.includes('call') ||
                  n.includes('bull') ||
                  n.includes('synthetic long')
              : n.includes('put') ||
                  n.includes('bear') ||
                  n.includes('synthetic short');
          })
          .slice(0, 2)
          .map((s: any) => ({
            ...s,
            confidenceScore: 35,
            reason: `Included because price action is strongly ${isBull ? 'bullish' : 'bearish'} (high confidence ${priceData.signal.confidence}). Option flow is neutral, so low confidence. Review Greeks and OI carefully.`,
          }));
        finalStrategies.push(...matching);
      }

      // Helper: style-specific trade guidance based on conviction
      function buildTradeGuidance(
        style: TradingStyle,
        conviction: number,
        bias: string,
        recommendation: string,
        priceData?: any,
      ) {
        const styleConfig = getStyleScoringConfig(style);
        const thresholds = {
          enter: styleConfig.convictionThreshold.enter,
          strong: styleConfig.convictionThreshold.strong,
          cautionBelow: styleConfig.convictionThreshold.medium,
        };

        let shouldConsider = false;
        let sizeAdvice =
          'Avoid or only tiny size if other personal confluence exists';
        let styleNote = '';

        if (bias.includes('Neutral')) {
          const neutralMin =
            style === TradingStyle.Scalper
              ? 35
              : style === TradingStyle.Positional
                ? 45
                : 40;
          shouldConsider = conviction >= neutralMin;
          sizeAdvice = shouldConsider
            ? 'Consider the recommended neutral/range strategies with small size. Good for IV expansion or time decay plays.'
            : 'Even neutral strategies lack enough support — wait.';
          styleNote = `For ${style} mode, neutral setups can be taken at lower conviction (~${neutralMin}+) when IV regime supports (e.g. Crushed).`;
        } else if (!bias.includes('Neutral')) {
          shouldConsider = conviction >= thresholds.enter;
          if (conviction >= thresholds.strong) {
            sizeAdvice =
              'Strong setup — take with your normal planned size for this style.';
          } else if (conviction >= thresholds.enter) {
            sizeAdvice =
              'Moderate setup — take with reduced size (50-70% of normal) and tight risk.';
          } else {
            sizeAdvice = 'Below style threshold — strongly consider skipping.';
          }
          const paPct = Math.round(styleConfig.priceActionWeight * 100);
          const ofPct = Math.round(styleConfig.optionFlowWeight * 100);
          if (style === TradingStyle.Scalper) {
            styleNote = `Scalper weights price action ${paPct}% / option flow ${ofPct}% with a lower conviction bar (enter >=${thresholds.enter}). Focus on 5m FVG, recent Order Blocks, and ATR stops.`;
          } else if (style === TradingStyle.Positional) {
            styleNote = `Positional weights option flow ${ofPct}% / price action ${paPct}% with the highest conviction bar (enter >=${thresholds.enter}). Prioritize 1h Order Blocks, PCR/skew, and larger structure.`;
          } else {
            styleNote = `Intraday balances price action ${paPct}% / option flow ${ofPct}% with a higher conviction bar (enter >=${thresholds.enter}). Use 15m FVG/OB as the primary read.`;
          }
        } else {
          styleNote =
            'No directional or neutral edge per the brain — best to stay flat regardless of style.';
        }

        // Style + new structure elements awareness
        if (priceData && priceData.structureElements) {
          const se = priceData.structureElements;
          if (
            style === TradingStyle.Scalper &&
            se.fvg &&
            se.fvg['5m'] &&
            se.fvg['5m'].length > 0
          ) {
            styleNote +=
              ' 5m FVG present - good scalper confluence if direction aligns.';
          }
          if (
            style === TradingStyle.Positional &&
            se.orderBlocks &&
            se.orderBlocks['1h'] &&
            se.orderBlocks['1h'].length > 0
          ) {
            styleNote +=
              ' 1h Order Block(s) present - strong positional level.';
          }
          if (priceData.atr && priceData.atr['5m'] > 0) {
            styleNote += ` Use ATR (5m: ${priceData.atr['5m']}) for stops instead of pure swings.`;
          }
        }

        return {
          chosenTradingStyle: style,
          currentConviction: conviction,
          scoringWeights: {
            priceAction: styleConfig.priceActionWeight,
            optionFlow: styleConfig.optionFlowWeight,
          },
          thresholdsForThisStyle: thresholds,
          shouldConsiderTrade: shouldConsider,
          sizeRecommendation: sizeAdvice,
          notes: `${recommendation}. ${styleNote} Always combine with your own risk rules and market context.`,
        };
      }

      const tradeGuidance = buildTradeGuidance(
        activeStyle,
        coreDecision.conviction,
        coreDecision.bias,
        coreDecision.recommendation,
        priceData,
      );

      const greeksInsights = optionData.greeksStrikeInsights;
      let greeksStrikeInsight: GreeksStrikeInsight | null = null;
      if (coreDecision.action === 'CE-BUY') {
        greeksStrikeInsight = greeksInsights?.CE ?? null;
      } else if (coreDecision.action === 'PE-BUY') {
        greeksStrikeInsight = greeksInsights?.PE ?? null;
      }

      if (
        greeksStrikeInsight &&
        coreDecision.conviction < scoringConfig.convictionThreshold.enter
      ) {
        greeksStrikeInsight = {
          ...greeksStrikeInsight,
          bestFit:
            'Conviction is below style threshold — prefer ITM or skip OTM; size down regardless of strike.',
        };
      }

      let exactStrikeRecommendation: ExactStrikeRecommendation | null = null;
      const nearbyChain = optionData.optionChainNearby ?? [];
      const indexSymbol = optionData.spotSymbol || priceData.symbol;
      if (
        (coreDecision.action === 'CE-BUY' || coreDecision.action === 'PE-BUY') &&
        nearbyChain.length > 0
      ) {
        exactStrikeRecommendation = buildExactStrikeRecommendation(
          nearbyChain,
          indexSymbol,
          coreDecision.action === 'CE-BUY' ? 'CE' : 'PE',
          activeStyle,
          coreDecision.conviction,
          greeksStrikeInsight,
          optionData.ivRegime,
          coreDecision.conviction < scoringConfig.convictionThreshold.enter,
        );
      }

      reply.send({
        symbol: optionData.spotSymbol || priceData.symbol,
        lastPrice: priceData.lastPrice,
        tradingStyle: activeStyle,
        action: coreDecision.action,
        bias: coreDecision.bias, // new top-level bias language
        primaryTimeframe: priceData.primaryTimeframe,

        risk: coreDecision.risk,
        recommendation: coreDecision.recommendation,
        conviction: coreDecision.conviction,
        momentumDecay: coreDecision.momentumDecay,
        scoringWeights: {
          priceAction: scoringConfig.priceActionWeight,
          optionFlow: scoringConfig.optionFlowWeight,
        },
        convictionThresholds: scoringConfig.convictionThreshold,

        // 1. Confluence and Decision Logic
        confluenceAndDecision,

        // New: Clear per-style trade guidance based on conviction score
        tradeGuidance,

        humanSummary: coreDecision.humanSummary,

        // 2. Price Action Components
        priceAction: {
          components: priceActionComponents,
          levels: priceData.levels,
          overallSignal: priceData.signal,
          atr: priceData.atr || { '5m': 0, '15m': 0, '1h': 0 },
          adx: priceData.adx || { '5m': 0, '15m': 0, '1h': 0 },
          // New structure elements - style aware in usage (scalper weights 5m higher)
          structureElements: priceData.structureElements || {},
          momentum: priceData.momentum,
          // Tip: Use atr['5m'] (for scalper) to set dynamic stops e.g. stopLoss = entry - (1.5 * atr5m)
          // Scalper: pay attention to 5m FVG and recent OB + higher ADX for trend strength.
          // Positional: 1h OBs and larger FVGs + ADX confirmation.
        },

        // 3. Option Flow Components
        optionFlow: {
          overallScore: optionData.score,
          bias: optionData.bias,
          ivRegime: optionData.ivRegime,
          components: optionFlowComponents,
          greeksStrikeInsight,
          exactStrikeRecommendation,
        },

        // 4. Final Strategies with confidence
        recommendedStrategies: finalStrategies,

        // Keep for advanced debugging
        _debug: {
          rawPrice: priceData,
          rawOption: optionData,
        },
      });
    } catch (error) {
      reply
        .status(HttpStatusCode.InternalServerError)
        .send({ error: 'Internal error while computing trade decision' });
    }
  });
}

// Core decision logic has been moved to plugins/decision-engine.ts
// Route is now thin and easy to maintain.
