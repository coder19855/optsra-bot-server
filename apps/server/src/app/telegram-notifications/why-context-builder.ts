import { AlertWhyContext } from '../types/alert-intelligence';
import { DecisionAction, TradeBias } from '../types/trade-decision';
import { TradingStyle } from '../types/trading-style';

type TradeDecisionBody = Record<string, unknown>;

function linesFromConfluence(body: TradeDecisionBody): string[] {
  const rows = body.confluenceAndDecision as
    | Array<{ field: string; value: unknown; explanation: string }>
    | undefined;
  if (!rows?.length) return [];
  return rows.map((row) => row.explanation).filter(Boolean);
}

function linesFromPriceAction(body: TradeDecisionBody): string[] {
  const pa = body.priceAction as
    | { components?: Record<string, { explanation?: string }> }
    | undefined;
  if (!pa?.components) return [];
  return Object.values(pa.components)
    .map((c) => c.explanation)
    .filter((line): line is string => Boolean(line));
}

function linesFromOptionFlow(body: TradeDecisionBody): string[] {
  const of = body.optionFlow as
    | {
        components?: Array<{
          name: string;
          score: number;
          interpretation: string;
          humanExplanation: string;
        }>;
      }
    | undefined;
  if (!of?.components?.length) return [];

  const sorted = [...of.components].sort(
    (a, b) => Math.abs(a.score) - Math.abs(b.score),
  );
  const weakest = sorted.slice(0, 3);
  return weakest.map(
    (c) =>
      `${c.name} (${c.interpretation}, score ${c.score.toFixed(2)}): ${c.humanExplanation}`,
  );
}

function buildVetoOrCaution(body: TradeDecisionBody): string[] {
  const cautions: string[] = [];
  const momentum = body.momentumDecay as
    | { decayPercent?: number; reasons?: string[] }
    | undefined;
  if (momentum?.decayPercent && momentum.decayPercent > 0) {
    cautions.push(
      `Momentum decay ${momentum.decayPercent}% — ${(momentum.reasons || []).join(' ')}`,
    );
  }

  const guidance = body.tradeGuidance as
    | { shouldConsiderTrade?: boolean; sizeRecommendation?: string }
    | undefined;
  if (guidance && !guidance.shouldConsiderTrade) {
    cautions.push(
      'Below style conviction threshold — system says caution / reduced size.',
    );
  }
  if (guidance?.sizeRecommendation) {
    cautions.push(guidance.sizeRecommendation);
  }

  const pa = body.priceAction as
    | { overallSignal?: { action?: string; confidence?: number } }
    | undefined;
  if (pa?.overallSignal?.action === 'NO-TRADE') {
    cautions.push('Price action engine returned NO-TRADE on primary timeframe.');
  } else if ((pa?.overallSignal?.confidence ?? 0) < 50) {
    cautions.push(
      `Price action confidence is only ${pa?.overallSignal?.confidence ?? 0}% — structure is not clean.`,
    );
  }

  return cautions;
}

export function buildAlertWhyContext(
  body: TradeDecisionBody,
  alertedAt: Date = new Date(),
): AlertWhyContext {
  const tradeGuidance = body.tradeGuidance as { notes?: string } | undefined;

  return {
    symbol: String(body.symbol ?? ''),
    tradingStyle: String(body.tradingStyle ?? TradingStyle.Intraday) as TradingStyle,
    action: (body.action as DecisionAction) ?? 'NO-TRADE',
    bias: (body.bias as TradeBias) ?? 'Neutral',
    conviction: Number(body.conviction ?? 0),
    alertedAt: alertedAt.toISOString(),
    confluenceLines: linesFromConfluence(body),
    priceActionLines: linesFromPriceAction(body),
    optionFlowLines: linesFromOptionFlow(body),
    vetoOrCaution: buildVetoOrCaution(body),
    tradeGuidanceNotes: tradeGuidance?.notes ? String(tradeGuidance.notes) : null,
    humanSummary: String(body.humanSummary ?? ''),
  };
}