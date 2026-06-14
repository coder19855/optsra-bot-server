import { OptionMetricsResponse } from '../types';
import { OptionChainSnapshotRecord } from '../types/option-chain-snapshot';

export function neutralOptionMetrics(
  symbol: string,
  spotLtp: number,
): OptionMetricsResponse {
  return {
    spotSymbol: symbol,
    spotLtp,
    spotLtpChangePercent: 0,
    score: 0,
    signal: 'NEUTRAL',
    bias: 'Neutral',
    ivRegime: 'Normal IV',
    components: {
      oi: 0,
      greeks: 0,
      iv: 0,
      trend: 0,
      pcr: 0,
      skew: 0,
      pain: 0,
      vix: 0,
    },
  } as OptionMetricsResponse;
}

export function snapshotToOptionMetrics(
  snap: OptionChainSnapshotRecord,
  symbol: string,
): OptionMetricsResponse {
  const score = snap.overallScore;
  const signal =
    score > 12
      ? 'BULLISH_TRADE'
      : score < -12
        ? 'BEARISH_TRADE'
        : 'NEUTRAL';

  const components = {
    oi: 0,
    greeks: 0,
    iv: 0,
    trend: 0,
    pcr: 0,
    skew: 0,
    pain: 0,
    vix: 0,
  };

  for (const comp of snap.components) {
    const key = comp.id?.toLowerCase() ?? comp.name?.toLowerCase() ?? '';
    if (key.includes('oi')) components.oi = comp.score;
    else if (key.includes('greek')) components.greeks = comp.score;
    else if (key === 'iv') components.iv = comp.score;
    else if (key.includes('trend')) components.trend = comp.score;
    else if (key.includes('pcr')) components.pcr = comp.score;
    else if (key.includes('skew')) components.skew = comp.score;
    else if (key.includes('pain')) components.pain = comp.score;
    else if (key.includes('vix')) components.vix = comp.score;
  }

  return {
    spotSymbol: symbol,
    spotLtp: snap.spotLtp,
    spotLtpChangePercent: 0,
    score,
    signal,
    bias: snap.bias,
    ivRegime: 'Normal IV',
    components,
  } as OptionMetricsResponse;
}