import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { FyersAPI } from 'fyers-api-v3';
import { MOMENTUM_DECAY } from '../constants/momentum-decay';
import {
  MomentumDecayInput,
  MomentumDecayResult,
  StructureElement,
  StructureType,
} from '../types/technical-analysis';

function hasRecentOpposingStructure(
  elements: StructureElement[],
  opposingType: StructureType,
  recentCount: number,
): boolean {
  return elements.slice(-recentCount).some((e) => e.type === opposingType);
}

export default fp(
  async (fastify: FastifyInstance) => {
    const computeRecentCandleMomentum = (
      candles: FyersAPI.Candle[],
      lookback: number = MOMENTUM_DECAY.CANDLE_LOOKBACK,
    ): number => {
      if (!candles || candles.length < 2) return 0;

      const recent = candles.slice(-Math.min(lookback, candles.length));
      let candleDir = 0;

      for (const c of recent) {
        if (c[4] > c[1]) candleDir += 1;
        else if (c[4] < c[1]) candleDir -= 1;
      }

      const firstOpen = recent[0][1];
      const lastClose = recent[recent.length - 1][4];
      const pctMove = firstOpen > 0 ? (lastClose - firstOpen) / firstOpen : 0;

      const raw =
        (candleDir / recent.length) * 0.55 +
        Math.max(-1, Math.min(1, pctMove * 80)) * 0.45;

      return Math.max(-1, Math.min(1, raw));
    };

    const computeMomentumDecay = (
      input: MomentumDecayInput,
    ): MomentumDecayResult => {
      if (input.direction === 'neutral') {
        return { decayPercent: 0, reasons: [] };
      }

      const isBullish = input.direction === 'bullish';
      let decay = 0;
      const reasons: string[] = [];
      const cfg = MOMENTUM_DECAY;

      const against5m = isBullish
        ? input.score5m < -cfg.SCORE_5M_OPPOSE_THRESHOLD
        : input.score5m > cfg.SCORE_5M_OPPOSE_THRESHOLD;
      if (against5m) {
        const severity = Math.min(1, Math.abs(input.score5m) / 0.4);
        const penalty = cfg.PENALTY_5M_MIN + severity * (cfg.PENALTY_5M_MAX - cfg.PENALTY_5M_MIN);
        decay += penalty;
        reasons.push(
          `5m momentum opposes structure (${input.score5m.toFixed(2)}) → -${Math.round(penalty * 100)}%`,
        );
      }

      const fvgs15 = input.structureElements?.fvg?.['15m'] || [];
      const obs15 = input.structureElements?.orderBlocks?.['15m'] || [];
      const opposingType: StructureType = isBullish ? 'bearish' : 'bullish';

      if (hasRecentOpposingStructure(fvgs15, opposingType, cfg.RECENT_FVG_COUNT)) {
        decay += cfg.FVG_PENALTY;
        reasons.push(`Recent ${opposingType} 15m FVG → -${Math.round(cfg.FVG_PENALTY * 100)}%`);
      }

      if (hasRecentOpposingStructure(obs15, opposingType, cfg.RECENT_OB_COUNT)) {
        decay += cfg.OB_PENALTY;
        reasons.push(`Recent ${opposingType} 15m Order Block → -${Math.round(cfg.OB_PENALTY * 100)}%`);
      }

      const nearResistance =
        input.resistance > 0 &&
        input.lastPrice > 0 &&
        (input.resistance - input.lastPrice) / input.lastPrice < cfg.NEAR_LEVEL_PCT;
      const nearSupport =
        input.support > 0 &&
        input.lastPrice > 0 &&
        (input.lastPrice - input.support) / input.lastPrice < cfg.NEAR_LEVEL_PCT;

      const rejectingResistance =
        isBullish &&
        nearResistance &&
        (input.fakeout15m === -1 ||
          input.score5m < -0.1 ||
          (input.recentMomentum15m ?? 0) < -0.25);
      const rejectingSupport =
        !isBullish &&
        nearSupport &&
        (input.fakeout15m === 1 ||
          input.score5m > 0.1 ||
          (input.recentMomentum15m ?? 0) > 0.25);

      if (rejectingResistance) {
        decay += cfg.LEVEL_REJECTION_PENALTY;
        reasons.push('Price rejecting resistance with bearish momentum → -15%');
      }
      if (rejectingSupport) {
        decay += cfg.LEVEL_REJECTION_PENALTY;
        reasons.push('Price rejecting support with bullish momentum → -15%');
      }

      const primaryAdx =
        input.primaryTF === '5m'
          ? input.adx5m
          : input.primaryTF === '15m'
            ? input.adx15m
            : input.adx1h;

      if (primaryAdx < cfg.ADX_WEAK_THRESHOLD) {
        decay += cfg.ADX_WEAK_PENALTY;
        reasons.push(
          `Primary ${input.primaryTF} ADX weakening (${primaryAdx.toFixed(1)}) → -${Math.round(cfg.ADX_WEAK_PENALTY * 100)}%`,
        );
      } else if (
        input.primaryTF !== '1h' &&
        primaryAdx < cfg.ADX_FADE_THRESHOLD &&
        input.adx1h > cfg.ADX_HTF_STRONG
      ) {
        decay += cfg.ADX_FADE_PENALTY;
        reasons.push('Intraday ADX fading while 1h trend persists → -10%');
      }

      const recentMom =
        input.primaryTF === '5m'
          ? input.recentMomentum5m
          : input.recentMomentum15m;
      if (recentMom !== undefined) {
        if (isBullish && recentMom < -cfg.RECENT_MOMENTUM_THRESHOLD) {
          decay += cfg.RECENT_MOMENTUM_PENALTY;
          reasons.push(`Recent ${input.primaryTF} candles moving down → -12%`);
        } else if (!isBullish && recentMom > cfg.RECENT_MOMENTUM_THRESHOLD) {
          decay += cfg.RECENT_MOMENTUM_PENALTY;
          reasons.push(`Recent ${input.primaryTF} candles moving up → -12%`);
        }
      }

      if (
        isBullish &&
        input.score15m < -cfg.SCORE_15M_OPPOSE_THRESHOLD &&
        input.primaryTF !== '5m'
      ) {
        decay += cfg.SCORE_15M_PENALTY;
        reasons.push(
          `15m momentum turning bearish (${input.score15m.toFixed(2)}) → -${Math.round(cfg.SCORE_15M_PENALTY * 100)}%`,
        );
      } else if (
        !isBullish &&
        input.score15m > cfg.SCORE_15M_OPPOSE_THRESHOLD &&
        input.primaryTF !== '5m'
      ) {
        decay += cfg.SCORE_15M_PENALTY;
        reasons.push(
          `15m momentum turning bullish (${input.score15m.toFixed(2)}) → -${Math.round(cfg.SCORE_15M_PENALTY * 100)}%`,
        );
      }

      return {
        decayPercent: Math.min(cfg.MAX_DECAY, decay),
        reasons,
      };
    };

    const applyMomentumDecay = (
      conviction: number,
      decayPercent: number,
    ): number => Math.max(0, Math.round(conviction * (1 - decayPercent)));

    const countDirectionalStructure = (
      elements: StructureElement[],
      direction: StructureType,
      recentCount: number = MOMENTUM_DECAY.DIRECTIONAL_STRUCTURE_COUNT,
    ): number =>
      elements.slice(-recentCount).filter((e) => e.type === direction).length;

    fastify.decorate('momentumDecayPlugin', {
      computeRecentCandleMomentum,
      computeMomentumDecay,
      applyMomentumDecay,
      countDirectionalStructure,
    });
  },
  { name: 'momentum-decay' },
);