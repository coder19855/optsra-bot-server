import { ExactStrikeRecommendation } from '../types/exact-strike-recommendation';
import { GreeksStrikeInsight, GreeksStrikeProfile } from '../types/greeks-strike-insight';

export interface DeckStrategyItem {
  strategy: string;
  risk?: string;
  confidenceScore: number;
  reason: string;
  executionHint?: string;
  riskManagement?: {
    positionSizing: string;
    stopLoss: string;
    takeProfit: string;
    exitStrategy: string;
  };
}

export interface DeckStrategyGuidance {
  shouldConsiderTrade: boolean;
  sizeRecommendation: string;
  notes: string;
  thresholds?: {
    enter: number;
    strong: number;
    cautionBelow: number;
  };
  scoringWeights?: {
    priceAction: number;
    optionFlow: number;
  };
}

export interface DeckStrategyPayload {
  action: string;
  bias: string;
  conviction: number;
  recommendation: string;
  humanSummary: string;
  ivRegime?: string;
  optionBias?: string;
  tradeGuidance: DeckStrategyGuidance;
  riskNotes?: string[];
  suggestedRiskPercent?: number;
  strategies: DeckStrategyItem[];
  greeksStrikeInsight?: GreeksStrikeInsight | null;
  exactStrike?: ExactStrikeRecommendation | null;
  replayNote?: string;
}

type TradeDecisionLike = {
  action: string;
  bias: string;
  conviction: number;
  recommendation?: string;
  humanSummary?: string;
  tradeGuidance?: {
    shouldConsiderTrade?: boolean;
    sizeRecommendation?: string;
    notes?: string;
    thresholdsForThisStyle?: {
      enter: number;
      strong: number;
      cautionBelow: number;
    };
    scoringWeights?: {
      priceAction: number;
      optionFlow: number;
    };
  };
  risk?: {
    suggestedRiskPercent?: number;
    notes?: string[];
  };
  recommendedStrategies?: Array<{
    strategy?: string;
    risk?: string;
    confidenceScore?: number;
    reason?: string;
    executionHint?: string;
    riskManagement?: {
      positionSizing?: string;
      stopLoss?: string;
      takeProfit?: string;
      exitStrategy?: string;
    };
  }>;
  optionFlow?: {
    bias?: string;
    ivRegime?: string;
    greeksStrikeInsight?: GreeksStrikeInsight | null;
    exactStrikeRecommendation?: ExactStrikeRecommendation | null;
  };
};

function normalizeRiskManagement(
  raw?: DeckStrategyItem['riskManagement'] | Record<string, unknown>,
): DeckStrategyItem['riskManagement'] | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const rm = raw as Record<string, string>;
  if (!rm.positionSizing && !rm.stopLoss && !rm.takeProfit && !rm.exitStrategy) {
    return undefined;
  }
  return {
    positionSizing: rm.positionSizing ?? '—',
    stopLoss: rm.stopLoss ?? '—',
    takeProfit: rm.takeProfit ?? '—',
    exitStrategy: rm.exitStrategy ?? '—',
  };
}

export function extractDeckStrategyPayload(
  decision: TradeDecisionLike,
  opts?: { replayNote?: string },
): DeckStrategyPayload {
  const guidance = decision.tradeGuidance ?? {};
  const strategies = (decision.recommendedStrategies ?? [])
    .map((strat, index) => ({
      strategy: String(strat.strategy ?? 'Strategy'),
      risk: strat.risk ? String(strat.risk) : undefined,
      confidenceScore: Number.isFinite(strat.confidenceScore)
        ? Number(strat.confidenceScore)
        : Math.max(20, 75 - index * 12),
      reason:
        strat.reason?.trim() ||
        'Selected based on current market regime and trading style.',
      executionHint: strat.executionHint?.trim() || undefined,
      riskManagement: normalizeRiskManagement(strat.riskManagement),
    }))
    .sort((a, b) => b.confidenceScore - a.confidenceScore);

  return {
    action: decision.action,
    bias: decision.bias,
    conviction: decision.conviction,
    recommendation: String(decision.recommendation ?? ''),
    humanSummary: String(decision.humanSummary ?? ''),
    ivRegime: decision.optionFlow?.ivRegime,
    optionBias: decision.optionFlow?.bias,
    tradeGuidance: {
      shouldConsiderTrade: Boolean(guidance.shouldConsiderTrade),
      sizeRecommendation: String(
        guidance.sizeRecommendation ?? 'Review conviction before sizing.',
      ),
      notes: String(guidance.notes ?? ''),
      thresholds: guidance.thresholdsForThisStyle,
      scoringWeights: guidance.scoringWeights,
    },
    riskNotes: decision.risk?.notes,
    suggestedRiskPercent: decision.risk?.suggestedRiskPercent,
    strategies,
    greeksStrikeInsight: decision.optionFlow?.greeksStrikeInsight ?? null,
    exactStrike: decision.optionFlow?.exactStrikeRecommendation ?? null,
    replayNote: opts?.replayNote,
  };
}

export function formatGreeksProfile(profile: GreeksStrikeProfile): string {
  const greekBits = [
    profile.delta != null ? `Δ ${profile.delta.toFixed(2)}` : null,
    profile.gamma != null ? `Γ ${profile.gamma.toFixed(4)}` : null,
    profile.theta != null ? `Θ ${profile.theta.toFixed(2)}` : null,
  ].filter(Boolean);
  return greekBits.join(' · ');
}