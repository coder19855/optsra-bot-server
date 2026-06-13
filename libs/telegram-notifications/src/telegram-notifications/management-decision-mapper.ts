import { PriceActionResponse } from '../types/technical-analysis';
import { TradeDecisionAlertPayload } from '../types/telegram-notifications';
import { DecisionAction } from '../types/trade-decision';

type PriceActionSignal = {
  action?: string;
  confidence?: number;
  structuralAction?: string;
  vetoReason?: string;
  confidenceBeforeDecay?: number;
};

/** Match trade-decision-fetch: zeroed confidence on a directional PA read = chart veto. */
export function normalizePriceActionSignal(signal?: PriceActionSignal): {
  action: TradeDecisionAlertPayload['priceAction']['action'];
  confidence: number;
  structuralAction?: 'CE-BUY' | 'PE-BUY';
  vetoReason?: string;
  confidenceBeforeDecay?: number;
} {
  let action = (signal?.action ?? 'NO-TRADE') as TradeDecisionAlertPayload['priceAction']['action'];
  const confidence = Number(signal?.confidence ?? 0);
  if (confidence === 0 && (action === 'CE-BUY' || action === 'PE-BUY')) {
    action = 'NO-TRADE';
  }

  const structuralAction = signal?.structuralAction;
  return {
    action,
    confidence,
    structuralAction:
      structuralAction === 'CE-BUY' || structuralAction === 'PE-BUY'
        ? structuralAction
        : undefined,
    vetoReason: signal?.vetoReason,
    confidenceBeforeDecay:
      signal?.confidenceBeforeDecay != null
        ? Number(signal.confidenceBeforeDecay)
        : undefined,
  };
}

export function toManagementDecisionPayload(input: {
  action: string;
  conviction: number;
  overallSignal?: PriceActionSignal;
}): TradeDecisionAlertPayload {
  return {
    action: input.action as DecisionAction,
    conviction: input.conviction,
    priceAction: normalizePriceActionSignal(input.overallSignal),
  } as TradeDecisionAlertPayload;
}

export function toManagementPriceData(
  priceData: PriceActionResponse,
): PriceActionResponse {
  return priceData;
}

/** Build price context for management brain from a Telegram alert payload. */
export function alertPayloadToManagementPriceData(
  payload: Pick<
    TradeDecisionAlertPayload,
    'lastPrice' | 'tradeSetup' | 'momentumDecayPercent'
  >,
): PriceActionResponse {
  return {
    lastPrice: payload.lastPrice,
    tradeSetup: payload.tradeSetup ?? undefined,
    momentumDecay:
      payload.momentumDecayPercent != null
        ? {
            decayPercent: payload.momentumDecayPercent,
            reasons: [],
          }
        : undefined,
  } as PriceActionResponse;
}

/** Build price context for management brain from technical-analysis only. */
export function priceActionToManagementPriceData(
  priceData: PriceActionResponse,
): PriceActionResponse {
  return priceData;
}

export function formatTradeDecisionError(statusCode: number, body: string): string {
  let detail = '';
  try {
    const parsed = JSON.parse(body) as {
      error?: unknown;
      priceStatus?: number;
      optionStatus?: number;
      priceError?: string;
      optionError?: string;
    };
    if (parsed.priceStatus != null || parsed.optionStatus != null) {
      const parts = [
        `price=${parsed.priceStatus ?? '?'}`,
        `option=${parsed.optionStatus ?? '?'}`,
      ];
      if (parsed.priceError) parts.push(`priceErr=${parsed.priceError}`);
      if (parsed.optionError) parts.push(`optionErr=${parsed.optionError}`);
      detail = ` (${parts.join(', ')})`;
    } else if (parsed.error != null) {
      detail =
        typeof parsed.error === 'string'
          ? `: ${parsed.error}`
          : `: ${JSON.stringify(parsed.error)}`;
    }
  } catch {
    // ignore malformed error bodies
  }
  return `trade-decision failed (${statusCode})${detail}`;
}