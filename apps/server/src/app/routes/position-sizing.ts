import { HttpStatusCode } from 'axios';
import { FastifyInstance } from 'fastify';
import { FYERS_OPTION_INDEX_SYMBOLS } from '../constants/fyers-symbols';
import {
  calculatePositionSizing,
  confidenceRiskMultiplier,
  extractAvailableBalance,
  resolveBaseRiskPercent,
} from '../position-sizing/calculator';
import { PriceActionResponse } from '../types';
import { PositionSizingResponse } from '../types/position-sizing';
import { TradingStyle } from '../trading-style';
import { ResponseStatus } from '../types/common';
import { computeManagementAdvice, getOpenPositionContext, PositionManagementContext } from '../telegram-notifications/position-monitor';

function parseTradingStyle(styleQuery?: string): TradingStyle {
  const styleStr = (styleQuery || 'INTRADAY').toUpperCase();
  if (styleStr === 'SCALPER' || styleStr === TradingStyle.Scalper) {
    return TradingStyle.Scalper;
  }
  if (styleStr === 'POSITIONAL' || styleStr === TradingStyle.Positional) {
    return TradingStyle.Positional;
  }
  return TradingStyle.Intraday;
}

function parseOptionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export default async function positionSizingRoute(fastify: FastifyInstance) {
  fastify.get('/api/position-sizing', async (request, reply) => {
    try {
      const {
        symbol,
        tradingStyle: styleQuery,
        riskPercent: riskPercentQuery,
        riskPoints: riskPointsQuery,
        premium,
        delta,
      } = request.query as {
        symbol?: string;
        tradingStyle?: string;
        riskPercent?: string | number;
        riskPoints?: string | number;
        premium?: string | number;
        delta?: string | number;
      };

      const activeStyle = parseTradingStyle(styleQuery);
      const indexMeta = symbol
        ? FYERS_OPTION_INDEX_SYMBOLS.find((s) => s.symbol === symbol)
        : undefined;

      const fundsRes = await fastify.fyers.get_funds();
      if (fundsRes.s !== ResponseStatus.ok) {
        return reply.code(fundsRes.code || HttpStatusCode.BadRequest).send({
          error: fundsRes.message || 'Failed to fetch Fyers funds',
        });
      }

      const { available, total } = extractAvailableBalance(
        fundsRes.fund_limit,
      );

      if (available <= 0) {
        return reply.code(HttpStatusCode.BadRequest).send({
          error: 'No available balance returned from Fyers funds API',
          fundBreakdown: fundsRes.fund_limit,
        });
      }

      let priceData: PriceActionResponse | null = null;
      if (symbol) {
        const paRes = await fastify.inject({
          method: 'GET',
          url: `/api/technical-analysis?symbol=${encodeURIComponent(symbol)}&tradingStyle=${activeStyle}`,
        });

        if (paRes.statusCode !== 200) {
          return reply.code(HttpStatusCode.BadGateway).send({
            error: 'Failed to fetch technical analysis for position sizing',
            statusCode: paRes.statusCode,
          });
        }

        priceData = JSON.parse(paRes.body) as PriceActionResponse;
      }

      const manualRiskPoints = parseOptionalNumber(riskPointsQuery);
      const setupRisk = priceData?.tradeSetup?.risk;
      const riskPoints =
        manualRiskPoints && manualRiskPoints > 0
          ? manualRiskPoints
          : setupRisk && setupRisk > 0
            ? setupRisk
            : 0;

      if (riskPoints <= 0) {
        return reply.code(HttpStatusCode.BadRequest).send({
          error:
            'riskPoints required: pass ?riskPoints= or ?symbol= with an active trade setup (CE/PE signal)',
          account: {
            availableBalance: available,
            totalBalance: total,
            fundBreakdown: fundsRes.fund_limit,
          },
        });
      }

      const lotSize = indexMeta?.lotSize ?? 1;
      const premiumVal = parseOptionalNumber(premium) ?? null;
      const deltaVal = parseOptionalNumber(delta) ?? undefined;

      let baseRiskPercent = resolveBaseRiskPercent(
        activeStyle,
        parseOptionalNumber(riskPercentQuery),
      );

      const notes: string[] = [];

      if (priceData?.signal) {
        const confMult = confidenceRiskMultiplier(priceData.signal.confidence);
        if (priceData.signal.action === 'NO-TRADE' || confMult === 0) {
          notes.push(
            'Signal is NO-TRADE or low confidence — sizing shown at base risk % for planning only; do not enter without a valid setup.',
          );
        } else {
          baseRiskPercent = resolveBaseRiskPercent(
            activeStyle,
            baseRiskPercent * confMult,
          );
          notes.push(
            `Risk % adjusted by signal confidence (${priceData.signal.confidence} → ×${confMult}).`,
          );
        }
      }

      const sizing = calculatePositionSizing({
        availableBalance: available,
        riskPercent: baseRiskPercent,
        riskPoints,
        lotSize,
        delta: deltaVal,
        premium: premiumVal,
      });

      const response: PositionSizingResponse = {
        account: {
          availableBalance: available,
          totalBalance: total,
          fundBreakdown: fundsRes.fund_limit,
        },
        inputs: {
          symbol,
          tradingStyle: activeStyle,
          riskPercent: baseRiskPercent,
          riskPoints,
          lotSize,
          delta: deltaVal ?? 0.5,
          premium: premiumVal,
        },
        sizing: {
          riskBudgetInr: sizing.riskBudgetInr,
          riskPerLotInr: sizing.riskPerLotInr,
          recommendedLots: sizing.recommendedLots,
          maxLotsByRisk: sizing.maxLotsByRisk,
          maxLotsByMargin: sizing.maxLotsByMargin,
          capitalAtRiskInr: sizing.capitalAtRiskInr,
          marginRequiredInr: sizing.marginRequiredInr,
          utilizationPercent: sizing.utilizationPercent,
        },
        tiers: sizing.tiers,
        notes: [...notes, ...sizing.notes],
      };

      if (priceData?.signal && priceData.tradeSetup) {
        response.tradeContext = {
          action: priceData.signal.action,
          confidence: priceData.signal.confidence,
          strength: priceData.signal.strength,
          entry: priceData.tradeSetup.entry,
          stopLoss: priceData.tradeSetup.stopLoss,
          riskPoints: priceData.tradeSetup.risk,
          vetoReason: priceData.signal.vetoReason,
        };
      }

      if (indexMeta) {
        response.notes.push(
          `Lot size for ${indexMeta.label}: ${indexMeta.lotSize} (${indexMeta.symbol}).`,
        );
      } else if (symbol) {
        response.notes.push(
          `Symbol ${symbol} not in index lot map — using lot size 1; pass a known index symbol for Nifty/BankNifty sizing.`,
        );
      }

      // Management brain awareness: if user already holds a position on this index,
      // reframe the sizing response as "adjustment" guidance rather than new entry size.
      try {
        if (symbol) {
          const posCtx = await getOpenPositionContext(fastify, [symbol]);
          if (posCtx.count > 0) {
            const mgmt = computeManagementAdvice(posCtx, {
              action: 'NO-TRADE',
              conviction: 0,
              priceAction: { action: 'NO-TRADE' as any },
              tradeGuidance: { shouldConsiderTrade: false },
            } as any, priceData as any, activeStyle);

            const mgmtContext: PositionManagementContext = {
              hasOpenPosition: true,
              heldDirection: posCtx.heldDirection,
              advice: mgmt,
              health: mgmt.positionHealth,
            };
            response.managementContext = mgmtContext;
            response.notes.unshift(
              `You are already holding on this index. The numbers below are for *adjusting risk* on your existing position, not for a new entry.`
            );
          }
        }
      } catch {}

      return reply.send(response);
    } catch (error) {
      return reply
        .status(HttpStatusCode.InternalServerError)
        .send({ error: 'Failed to compute position sizing' });
    }
  });
}