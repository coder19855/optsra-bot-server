import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Groq from 'groq-sdk';
import OpenAI from 'openai';
import { AIAnalysisRequest, AIAnalysisResponse, AIProvider } from '../types/ai-agent';

export default fp(
  async (fastify: FastifyInstance) => {
    const getActiveProvider = (): AIProvider => {
      const provider = (process.env.ACTIVE_AI_PROVIDER || 'GEMINI').toUpperCase();
      return provider as AIProvider;
    };

    const buildAnalysisPrompt = (request: AIAnalysisRequest): string => {
      return `
        As a senior options trading strategist for Indian Markets (NIFTY/BANKNIFTY), analyze this setup.
        
        DATA:
        - Symbol: ${request.symbol}
        - Style: ${request.tradingStyle}
        - Current Bias: ${request.bias}
        - Action: ${request.action}
        - Conviction: ${request.conviction}%
        
        PRICE ACTION (${request.priceAction.primaryTF}):
        - Score: ${request.priceAction.primaryScore}
        - Support: ${request.priceAction.levels.support}
        - Resistance: ${request.priceAction.levels.resistance}
        
        OPTION FLOW:
        - Overall Score: ${request.optionFlow.overallScore}
        - IV Regime: ${request.optionFlow.ivRegime}
        - Top Components: ${request.optionFlow.topComponents.map(c => `${c.name}: ${c.interpretation}`).join(', ')}

        TASK:
        Provide a 1-sentence "Beta Note" and a verdict (AGREE, DISAGREE, or CAUTION).
        Return ONLY JSON in this format:
        { "verdict": "AGREE", "confidenceAdjustment": 0, "betaNote": "..." }
      `;
    };

    const callGemini = async (request: AIAnalysisRequest): Promise<AIAnalysisResponse> => {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) throw new Error('GEMINI_API_KEY not configured');

      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

      const result = await model.generateContent(buildAnalysisPrompt(request));
      const response = await result.response;
      const text = response.text();
      const cleanJson = text.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(cleanJson);

      return {
        provider: 'GEMINI',
        model: 'gemini-1.5-flash',
        verdict: parsed.verdict,
        confidenceAdjustment: parsed.confidenceAdjustment || 0,
        betaNote: parsed.betaNote,
        timestamp: Date.now(),
      };
    };

    const callGroq = async (request: AIAnalysisRequest): Promise<AIAnalysisResponse> => {
      const apiKey = process.env.GROQ_API_KEY;
      if (!apiKey) throw new Error('GROQ_API_KEY not configured');

      const groq = new Groq({ apiKey });
      const prompt = `
        Analyze this Nifty/BankNifty setup:
        - Symbol: ${request.symbol}
        - Bias: ${request.bias}
        - Action: ${request.action}
        - Conviction: ${request.conviction}%
        - Price Score: ${request.priceAction.primaryScore}
        - IV: ${request.optionFlow.ivRegime}
        
        Return JSON ONLY: { "verdict": "AGREE/DISAGREE/CAUTION", "confidenceAdjustment": number, "betaNote": "1 sentence opinion" }
      `;

      const chatCompletion = await groq.chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
        model: 'llama-3-8b-8192',
        response_format: { type: 'json_object' },
      });

      const parsed = JSON.parse(chatCompletion.choices[0].message.content || '{}');

      return {
        provider: 'GROQ',
        model: 'llama-3-8b-8192',
        verdict: parsed.verdict,
        confidenceAdjustment: parsed.confidenceAdjustment || 0,
        betaNote: parsed.betaNote,
        timestamp: Date.now(),
      };
    };

    const callOpenAI = async (request: AIAnalysisRequest): Promise<AIAnalysisResponse> => {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) throw new Error('OPENAI_API_KEY not configured');

      const openai = new OpenAI({ apiKey });
      const model = 'gpt-4o-mini';

      const response = await openai.chat.completions.create({
        model,
        messages: [{ role: 'user', content: buildAnalysisPrompt(request) }],
        response_format: { type: 'json_object' },
      });

      const parsed = JSON.parse(response.choices[0].message.content || '{}');

      return {
        provider: 'OPENAI',
        model,
        verdict: parsed.verdict,
        confidenceAdjustment: parsed.confidenceAdjustment || 0,
        betaNote: parsed.betaNote,
        timestamp: Date.now(),
      };
    };

    const callXai = async (request: AIAnalysisRequest): Promise<AIAnalysisResponse> => {
      const apiKey = process.env.XAI_API_KEY;
      if (!apiKey) throw new Error('XAI_API_KEY not configured');

      const xai = new OpenAI({
        apiKey,
        baseURL: 'https://api.x.ai/v1',
      });
      const model = 'grok-beta';

      const response = await xai.chat.completions.create({
        model,
        messages: [{ role: 'user', content: buildAnalysisPrompt(request) }],
        response_format: { type: 'json_object' },
      });

      const parsed = JSON.parse(response.choices[0].message.content || '{}');

      return {
        provider: 'XAI',
        model,
        verdict: parsed.verdict,
        confidenceAdjustment: parsed.confidenceAdjustment || 0,
        betaNote: parsed.betaNote,
        timestamp: Date.now(),
      };
    };

    const aiCache = new Map<string, AIAnalysisResponse>();

    const aiAgent = {
      analyze: async (request: AIAnalysisRequest): Promise<AIAnalysisResponse> => {
        const provider = getActiveProvider();
        const cacheKey = `${request.symbol}-${request.action}-${provider}`;
        const cached = aiCache.get(cacheKey);

        // Throttle: If same action/symbol in last 15 mins, reuse opinion
        if (cached && Date.now() - cached.timestamp < 15 * 60 * 1000) {
          return cached;
        }

        try {
          let response: AIAnalysisResponse;
          switch (provider) {
            case 'GROQ':
              response = await callGroq(request);
              break;
            case 'OPENAI':
              response = await callOpenAI(request);
              break;
            case 'XAI':
              response = await callXai(request);
              break;
            default:
              response = await callGemini(request);
          }
          aiCache.set(cacheKey, response);
          return response;
        } catch (error: any) {
          const isQuotaError = 
            error.status === 429 || 
            error.message?.toLowerCase().includes('quota') || 
            error.message?.toLowerCase().includes('credit') ||
            error.message?.toLowerCase().includes('rate limit');

          if (isQuotaError) {
            fastify.log.error({ provider, err: error.message }, 'AI Credit/Quota Exhausted');
          } else {
            fastify.log.error({ err: error }, 'AI Agent analysis failed');
          }

          return {
            provider,
            model: 'error-fallback',
            verdict: 'CAUTION',
            confidenceAdjustment: 0,
            betaNote: isQuotaError 
              ? `AI analysis paused (Quota exhausted for ${provider}).` 
              : 'AI analysis temporarily unavailable.',
            timestamp: Date.now(),
          };
        }
      },
    };

    fastify.decorate('aiAgent', aiAgent);
  },
  { name: 'ai-agent' },
);
