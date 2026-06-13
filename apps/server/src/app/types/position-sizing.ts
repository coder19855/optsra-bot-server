import { TradeAction } from './technical-analysis';
import { TradingStyle } from './trading-style';

export interface PositionSizingTier {
  label: 'conservative' | 'standard' | 'aggressive';
  riskPercent: number;
  lots: number;
  capitalAtRiskInr: number;
  marginRequiredInr: number | null;
}

export interface PositionSizingResponse {
  account: {
    availableBalance: number;
    totalBalance: number | null;
    fundBreakdown: Array<{
      id: number;
      title: string;
      equityAmount: number;
      commodityAmount: number;
    }>;
  };
  inputs: {
    symbol?: string;
    tradingStyle: TradingStyle;
    riskPercent: number;
    riskPoints: number;
    lotSize: number;
    delta: number;
    premium: number | null;
  };
  tradeContext?: {
    action: TradeAction;
    confidence: number;
    strength: string;
    entry: number;
    stopLoss: number;
    riskPoints: number;
    vetoReason?: string;
  };
  sizing: {
    riskBudgetInr: number;
    riskPerLotInr: number;
    recommendedLots: number;
    maxLotsByRisk: number;
    maxLotsByMargin: number | null;
    capitalAtRiskInr: number;
    marginRequiredInr: number | null;
    utilizationPercent: number | null;
  };
  tiers: PositionSizingTier[];
  notes: string[];
  managementContext?: any;
}