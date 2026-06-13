import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { GoogleGenerativeAI } from '@google/generative-ai';

import OpenAI from 'openai';
import { AIAnalysisRequest, AIAnalysisResponse, AIProvider } from '../types/ai-agent';

// ===== Token Bucket Rate Limiter =====
interface TokenBucket {
  tokens: number;
  maxTokens: number;
  refillRate: number; // tokens per millisecond
  lastRefillTime: number;
}

// ===== Circuit Breaker =====
type CircuitBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface CircuitBreakerConfig {
  state: CircuitBreakerState;
  errorsCount: number;
  lastErrorTime: number;
  threshold: number;
  cooldownMs: number;
}

export default fp(
  async (fastify: FastifyInstance) => {
    // Initialize Rate Limiter
    const rateLimitPerMin = parseInt(process.env.AI_RATE_LIMIT_PER_MIN || '60', 10);
    const rateBurst = parseInt(process.env.AI_RATE_BURST || '5', 10);

    const tokenBucket: TokenBucket = {
      tokens: rateBurst,
      maxTokens: rateBurst,
      refillRate: rateLimitPerMin / (60 * 1000), // tokens per millisecond
      lastRefillTime: Date.now(),
    };

    // Initialize Circuit Breaker
    const cbThreshold = parseInt(process.env.AI_CB_THRESHOLD || '5', 10);
    const cbCooldownMs = parseInt(process.env.AI_CB_COOLDOWN_MS || '60000', 10);

    const circuitBreaker: CircuitBreakerConfig = {
      state: 'CLOSED',
      errorsCount: 0,
      lastErrorTime: 0,
      threshold: cbThreshold,
      cooldownMs: cbCooldownMs,
    };

    // ===== Rate Limiter Helper =====
    const checkRateLimiter = (): boolean => {
      const now = Date.now();
      const timeSinceRefill = now - tokenBucket.lastRefillTime;
      const tokensToAdd = timeSinceRefill * tokenBucket.refillRate;
      
      tokenBucket.tokens = Math.min(tokenBucket.tokens + tokensToAdd, tokenBucket.maxTokens);
      tokenBucket.lastRefillTime = now;

      if (tokenBucket.tokens >= 1) {
        tokenBucket.tokens -= 1;
        return true; // Request allowed
      }
      return false; // Request throttled
    };

    // ===== Circuit Breaker Helper =====
    const checkCircuitBreaker = (): boolean => {
      const now = Date.now();

      // If in OPEN state, check if cooldown has passed
      if (circuitBreaker.state === 'OPEN') {
        if (now - circuitBreaker.lastErrorTime >= circuitBreaker.cooldownMs) {
          circuitBreaker.state = 'HALF_OPEN';
          circuitBreaker.errorsCount = 0;
          fastify.log.info('Circuit Breaker: transitioning to HALF_OPEN');
          return true; // Allow one request to test
        }
        return false; // Still open, reject
      }

      // CLOSED or HALF_OPEN: allow request
      return true;
    };

    // ===== Record Circuit Breaker Error =====
    const recordCircuitBreakerError = (): void => {
      circuitBreaker.errorsCount += 1;
      circuitBreaker.lastErrorTime = Date.now();

      if (circuitBreaker.errorsCount >= circuitBreaker.threshold) {
        circuitBreaker.state = 'OPEN';
        fastify.log.warn(
          {
            errorCount: circuitBreaker.errorsCount,
            threshold: circuitBreaker.threshold,
          },
          'Circuit Breaker: OPENED due to consecutive errors',
        );
      }
    };

    // ===== Record Circuit Breaker Success =====
    const recordCircuitBreakerSuccess = (): void => {
      if (circuitBreaker.state === 'HALF_OPEN') {
        circuitBreaker.state = 'CLOSED';
        circuitBreaker.errorsCount = 0;
        fastify.log.info('Circuit Breaker: recovered to CLOSED');
      } else if (circuitBreaker.state === 'CLOSED') {
        circuitBreaker.errorsCount = Math.max(0, circuitBreaker.errorsCount - 1);
      }
    };

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
      // Check rate limiter and circuit breaker
      if (!checkRateLimiter()) {
        fastify.log.warn({ provider: 'GEMINI' }, 'Rate limit exceeded');
        return {
          provider: 'GEMINI',
          model: 'gemini-1.5-flash',
          verdict: 'CAUTION',
          confidenceAdjustment: 0,
          betaNote: 'AI analysis rate limited. Please retry shortly.',
          timestamp: Date.now(),
        };
      }

      if (!checkCircuitBreaker()) {
        fastify.log.warn({ provider: 'GEMINI', state: circuitBreaker.state }, 'Circuit breaker is open');
        return {
          provider: 'GEMINI',
          model: 'gemini-1.5-flash',
          verdict: 'CAUTION',
          confidenceAdjustment: 0,
          betaNote: 'AI service temporarily unavailable. Circuit breaker is active.',
          timestamp: Date.now(),
        };
      }

      try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) throw new Error('GEMINI_API_KEY not configured');

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

        const result = await model.generateContent(buildAnalysisPrompt(request));
        const response = await result.response;
        const text = response.text();
        const cleanJson = text.replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(cleanJson);

        recordCircuitBreakerSuccess();

        return {
          provider: 'GEMINI',
          model: 'gemini-1.5-flash',
          verdict: parsed.verdict,
          confidenceAdjustment: parsed.confidenceAdjustment || 0,
          betaNote: parsed.betaNote,
          timestamp: Date.now(),
        };
      } catch (error: any) {
        recordCircuitBreakerError();
        const isQuotaError = 
          error.status === 429 || 
          error.message?.toLowerCase().includes('quota') || 
          error.message?.toLowerCase().includes('credit') ||
          error.message?.toLowerCase().includes('rate limit');

        if (isQuotaError) {
          fastify.log.error({ provider: 'GEMINI', err: error.message }, 'AI Credit/Quota Exhausted');
        } else {
          fastify.log.error({ err: error }, 'GEMINI analysis failed');
        }

        return {
          provider: 'GEMINI',
          model: 'error-fallback',
          verdict: 'CAUTION',
          confidenceAdjustment: 0,
          betaNote: isQuotaError 
            ? 'AI analysis paused (Quota exhausted).' 
            : 'AI analysis temporarily unavailable.',
          timestamp: Date.now(),
        };
      }
    };

    const callGroq = async (request: AIAnalysisRequest): Promise<AIAnalysisResponse> => {
      // Check rate limiter and circuit breaker
      if (!checkRateLimiter()) {
        fastify.log.warn({ provider: 'GROQ' }, 'Rate limit exceeded');
        return {
          provider: 'GROQ',
          model: 'llama-3-8b-8192',
          verdict: 'CAUTION',
          confidenceAdjustment: 0,
          betaNote: 'AI analysis rate limited. Please retry shortly.',
          timestamp: Date.now(),
        };
      }

      if (!checkCircuitBreaker()) {
        fastify.log.warn({ provider: 'GROQ', state: circuitBreaker.state }, 'Circuit breaker is open');
        return {
          provider: 'GROQ',
          model: 'llama-3-8b-8192',
          verdict: 'CAUTION',
          confidenceAdjustment: 0,
          betaNote: 'AI service temporarily unavailable. Circuit breaker is active.',
          timestamp: Date.now(),
        };
      }

      try {
        const apiKey = process.env.GROQ_API_KEY;
        if (!apiKey) throw new Error('GROQ_API_KEY not configured');

        // Dynamically import groq-sdk to avoid hard build-time dependency when not installed.
        let GroqModule: any = null;
        try {
          // Use require guarded with ts-ignore to avoid build-time type dependency when package absent
          // @ts-ignore
          GroqModule = require('groq-sdk');
        } catch (e) {
          GroqModule = null;
        }
        if (!GroqModule) throw new Error('groq-sdk not available');
        const Groq = (GroqModule as any).default ?? GroqModule;

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

        recordCircuitBreakerSuccess();

        return {
          provider: 'GROQ',
          model: 'llama-3-8b-8192',
          verdict: parsed.verdict,
          confidenceAdjustment: parsed.confidenceAdjustment || 0,
          betaNote: parsed.betaNote,
          timestamp: Date.now(),
        };
      } catch (error: any) {
        recordCircuitBreakerError();
        const isQuotaError = 
          error.status === 429 || 
          error.message?.toLowerCase().includes('quota') || 
          error.message?.toLowerCase().includes('credit') ||
          error.message?.toLowerCase().includes('rate limit');

        if (isQuotaError) {
          fastify.log.error({ provider: 'GROQ', err: error.message }, 'AI Credit/Quota Exhausted');
        } else {
          fastify.log.error({ err: error }, 'GROQ analysis failed');
        }

        return {
          provider: 'GROQ',
          model: 'error-fallback',
          verdict: 'CAUTION',
          confidenceAdjustment: 0,
          betaNote: isQuotaError 
            ? 'AI analysis paused (Quota exhausted).' 
            : 'AI analysis temporarily unavailable.',
          timestamp: Date.now(),
        };
      }
    };

    const callOpenAI = async (request: AIAnalysisRequest): Promise<AIAnalysisResponse> => {
      // Check rate limiter and circuit breaker
      if (!checkRateLimiter()) {
        fastify.log.warn({ provider: 'OPENAI' }, 'Rate limit exceeded');
        return {
          provider: 'OPENAI',
          model: 'gpt-4o-mini',
          verdict: 'CAUTION',
          confidenceAdjustment: 0,
          betaNote: 'AI analysis rate limited. Please retry shortly.',
          timestamp: Date.now(),
        };
      }

      if (!checkCircuitBreaker()) {
        fastify.log.warn({ provider: 'OPENAI', state: circuitBreaker.state }, 'Circuit breaker is open');
        return {
          provider: 'OPENAI',
          model: 'gpt-4o-mini',
          verdict: 'CAUTION',
          confidenceAdjustment: 0,
          betaNote: 'AI service temporarily unavailable. Circuit breaker is active.',
          timestamp: Date.now(),
        };
      }

      try {
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

        recordCircuitBreakerSuccess();

        return {
          provider: 'OPENAI',
          model,
          verdict: parsed.verdict,
          confidenceAdjustment: parsed.confidenceAdjustment || 0,
          betaNote: parsed.betaNote,
          timestamp: Date.now(),
        };
      } catch (error: any) {
        recordCircuitBreakerError();
        const isQuotaError = 
          error.status === 429 || 
          error.message?.toLowerCase().includes('quota') || 
          error.message?.toLowerCase().includes('credit') ||
          error.message?.toLowerCase().includes('rate limit');

        if (isQuotaError) {
          fastify.log.error({ provider: 'OPENAI', err: error.message }, 'AI Credit/Quota Exhausted');
        } else {
          fastify.log.error({ err: error }, 'OpenAI analysis failed');
        }

        return {
          provider: 'OPENAI',
          model: 'error-fallback',
          verdict: 'CAUTION',
          confidenceAdjustment: 0,
          betaNote: isQuotaError 
            ? 'AI analysis paused (Quota exhausted).' 
            : 'AI analysis temporarily unavailable.',
          timestamp: Date.now(),
        };
      }
    };

    const callXai = async (request: AIAnalysisRequest): Promise<AIAnalysisResponse> => {
      // Check rate limiter and circuit breaker
      if (!checkRateLimiter()) {
        fastify.log.warn({ provider: 'XAI' }, 'Rate limit exceeded');
        return {
          provider: 'XAI',
          model: 'grok-beta',
          verdict: 'CAUTION',
          confidenceAdjustment: 0,
          betaNote: 'AI analysis rate limited. Please retry shortly.',
          timestamp: Date.now(),
        };
      }

      if (!checkCircuitBreaker()) {
        fastify.log.warn({ provider: 'XAI', state: circuitBreaker.state }, 'Circuit breaker is open');
        return {
          provider: 'XAI',
          model: 'grok-beta',
          verdict: 'CAUTION',
          confidenceAdjustment: 0,
          betaNote: 'AI service temporarily unavailable. Circuit breaker is active.',
          timestamp: Date.now(),
        };
      }

      try {
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

        recordCircuitBreakerSuccess();

        return {
          provider: 'XAI',
          model,
          verdict: parsed.verdict,
          confidenceAdjustment: parsed.confidenceAdjustment || 0,
          betaNote: parsed.betaNote,
          timestamp: Date.now(),
        };
      } catch (error: any) {
        recordCircuitBreakerError();
        const isQuotaError = 
          error.status === 429 || 
          error.message?.toLowerCase().includes('quota') || 
          error.message?.toLowerCase().includes('credit') ||
          error.message?.toLowerCase().includes('rate limit');

        if (isQuotaError) {
          fastify.log.error({ provider: 'XAI', err: error.message }, 'AI Credit/Quota Exhausted');
        } else {
          fastify.log.error({ err: error }, 'XAI analysis failed');
        }

        return {
          provider: 'XAI',
          model: 'error-fallback',
          verdict: 'CAUTION',
          confidenceAdjustment: 0,
          betaNote: isQuotaError 
            ? 'AI analysis paused (Quota exhausted).' 
            : 'AI analysis temporarily unavailable.',
          timestamp: Date.now(),
        };
      }
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
        
        // Cache the response regardless of success/failure
        aiCache.set(cacheKey, response);
        return response;
      },
    };

    fastify.decorate('aiAgent', aiAgent);
  },
  { name: 'ai-agent' },
);
