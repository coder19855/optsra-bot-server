import { DecisionAction } from './trade-decision';
import { TradingStyle } from './trading-style';

export type AIProvider = 'GEMINI' | 'GROQ' | 'OPENAI' | 'XAI';

export interface AIAnalysisRequest {
  symbol: string;
  tradingStyle: TradingStyle;
  action: DecisionAction;
  conviction: number;
  bias: string;
  priceAction: {
    primaryTF: string;
    primaryScore: number;
    levels: { support: number; resistance: number };
    momentum: any;
    structure: any;
  };
  optionFlow: {
    overallScore: number;
    ivRegime: string;
    topComponents: Array<{ name: string; score: number; interpretation: string }>;
  };
}

export interface AIAnalysisResponse {
  provider: AIProvider;
  model: string;
  verdict: 'AGREE' | 'DISAGREE' | 'CAUTION';
  confidenceAdjustment: number; // e.g., -5, 0, +5
  betaNote: string;
  timestamp: number;
}
