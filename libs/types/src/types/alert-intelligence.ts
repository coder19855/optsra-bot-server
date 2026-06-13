import { AdaptiveConvictionInsight } from './adaptive-conviction';
import { ExactStrikeRecommendation } from './exact-strike-recommendation';
import { DecisionAction, TradeBias } from './trade-decision';
import { TradingStyle } from './trading-style';

export interface AlertWhyComponent {
  name: string;
  score: number;
  interpretation: string;
  humanExplanation: string;
}

export type AlertWhySource = 'alert' | 'poll' | 'live';

export interface AlertWhyContext {
  symbol: string;
  tradingStyle: TradingStyle;
  action: DecisionAction;
  bias: TradeBias;
  conviction: number;
  alertedAt: string;
  /** Whether a Telegram notification was actually sent for this snapshot. */
  wasNotified?: boolean;
  /** alert = saved when notified; poll = latest poll state; live = on-demand /why fetch. */
  source?: AlertWhySource;
  confluenceLines: string[];
  priceActionLines: string[];
  optionFlowLines: string[];
  vetoOrCaution: string[];
  tradeGuidanceNotes: string | null;
  humanSummary: string;
  adaptiveConviction?: AdaptiveConvictionInsight;
}

export interface SignalOutcomeRecord {
  key: string;
  symbol: string;
  tradingStyle: TradingStyle;
  action: 'CE-BUY' | 'PE-BUY';
  sessionDate: string;
  alertedAt: Date;
  entrySpot: number;
  entryPremium: number;
  optionSymbol: string;
  strike: number;
  conviction: number;
  lotSize: number;
  status: 'open' | 'win' | 'loss' | 'flat';
  lastPremium: number | null;
  lastSpot: number | null;
  pnlPerUnitInr: number | null;
  pnlPercent: number | null;
  maxPnlPercent: number | null;
  minPnlPercent: number | null;
  closedAt: Date | null;
  closeReason: string | null;
  updatedAt: Date;
}

export interface EnrichedAlertExtras {
  whyContext: AlertWhyContext;
  exactStrikeRecommendation?: ExactStrikeRecommendation;
  adaptiveConviction?: AdaptiveConvictionInsight;
}