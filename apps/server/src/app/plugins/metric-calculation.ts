import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { FyersAPI } from 'fyers-api-v3';
import { OptionType } from '../types';

export default fp(
  async (fastify: FastifyInstance) => {
    // 0. Filter Helper: Removes 'dead weight' by focusing on strikes near the spot
    const filterNearbyStrikes = (
      chain: FyersAPI.OptionChainData[],
      spot: number,
      range: number,
    ) => {
      if (chain.length === 0) return [];
      const strikes = [...new Set(chain.map((r) => r.strike_price))].sort(
        (a, b) => a - b,
      );
      const atmStrike = strikes.reduce(
        (a, b) => (Math.abs(b - spot) < Math.abs(a - spot) ? b : a),
        strikes[0],
      );
      const atmIdx = strikes.indexOf(atmStrike);
      const startIdx = Math.max(0, atmIdx - range);
      const endIdx = Math.min(strikes.length - 1, atmIdx + range);
      const nearbyStrikes = new Set(strikes.slice(startIdx, endIdx + 1));
      return chain.filter((r) => nearbyStrikes.has(r.strike_price));
    };

    // 1. OI Pressure
    const calcOiPressure = (
      chain: FyersAPI.OptionChainData[],
      spot: number,
    ) => {
      let bullish = 0;
      let bearish = 0;

      chain.forEach((row) => {
        const dOI = row.oich;
        if (row.option_type === OptionType.PE && row.strike_price < spot)
          bullish += dOI;
        if (row.option_type === OptionType.CE && row.strike_price > spot)
          bearish += dOI;
      });

      const raw = bullish - bearish;
      // Compare intraday net pressure against total intraday activity
      const totalIntradayAct = chain.reduce(
        (sum, r) => sum + Math.abs(r.oich),
        0,
      );

      if (totalIntradayAct === 0) return 0;

      return fastify.utilsPlugin.norm(raw, totalIntradayAct / 2);
    };

    // 3. PCR Score
    const calcPcrScore = (chain: FyersAPI.OptionChainData[]) => {
      let callOI = 0;
      let putOI = 0;

      for (const row of chain) {
        if (row.option_type === OptionType.CE) callOI += row.oi;
        else putOI += row.oi;
      }

      const pcr = callOI === 0 ? 0 : putOI / callOI;
      return fastify.utilsPlugin.norm(pcr - 1, 1.0);
    };

    // 4. IV Skew (25Δ put vs 25Δ call)
    const calcSkewScore = (chain: FyersAPI.OptionChainData[]) => {
      const puts = chain
        .filter((r) => r.option_type === OptionType.PE)
        .sort((a, b) => (a.greeks?.delta ?? 0) - (b.greeks?.delta ?? 0));

      const calls = chain
        .filter((r) => r.option_type === OptionType.CE)
        .sort((a, b) => (b.greeks?.delta ?? 0) - (a.greeks?.delta ?? 0)); // FIXED

      if (puts.length === 0 || calls.length === 0) return null;

      const findClosest = (arr: FyersAPI.OptionChainData[], target: number) =>
        arr.reduce((prev, curr) =>
          Math.abs((curr.greeks?.delta ?? 0) - target) <
          Math.abs((prev.greeks?.delta ?? 0) - target)
            ? curr
            : prev,
        );

      const put25 = findClosest(puts, -0.25);
      const call25 = findClosest(calls, 0.25);

      if (!put25?.greeks?.iv || !call25?.greeks?.iv) return null;

      const skew = (put25.greeks?.iv ?? 0) - (call25.greeks?.iv ?? 0);
      return fastify.utilsPlugin.norm(skew, 5);
    };

    // 5. ATM helper
    const getATM = (chain: FyersAPI.OptionChainData[], spot: number) => {
      const strikes = [...new Set(chain.map((r) => r.strike_price))];
      const atmStrike = strikes.reduce((a, b) =>
        Math.abs(b - spot) < Math.abs(a - spot) ? b : a,
      );

      const atmRows = chain.filter((r) => r.strike_price === atmStrike);

      if (atmRows.length === 0) {
        return {
          strike: atmStrike,
          iv: null,
          delta: null,
          gamma: null,
          vega: null,
          theta: null,
        };
      }

      const avg = (fn: (r: FyersAPI.OptionChainData) => number | null) => {
        const values = atmRows.map(fn).filter((v) => v !== null);
        if (values.length === 0) return null;
        return values.reduce((sum, v) => sum + (v ?? 0), 0) / values.length;
      };

      return {
        strike: atmStrike,
        iv: avg((r) => r.greeks?.iv ?? null),
        delta: avg((r) => r.greeks?.delta ?? null),
        gamma: avg((r) => r.greeks?.gamma ?? null),
        vega: avg((r) => r.greeks?.vega ?? null),
        theta: avg((r) => r.greeks?.theta ?? null),
      };
    };

    // 6. ATM IV Score
    const calcAtmIvScore = (
      chain: FyersAPI.OptionChainData[],
      spot: number,
    ) => {
      const atm = getATM(chain, spot);
      if (atm.iv === null) return null;
      return fastify.utilsPlugin.norm(20 - atm.iv, 10);
    };

    // 7. Max Pain Score
    const calcMaxPainScore = (
      chain: FyersAPI.OptionChainData[],
      spot: number,
    ) => {
      const strikes = [...new Set(chain.map((r) => r.strike_price))];

      const painByStrike = strikes.map((expiryStrike) => {
        let pain = 0;
        for (const row of chain) {
          const intrinsic =
            row.option_type === OptionType.CE
              ? Math.max(0, expiryStrike - row.strike_price)
              : Math.max(0, row.strike_price - expiryStrike);
          pain += intrinsic * row.oi;
        }
        return { strike: expiryStrike, pain };
      });

      if (painByStrike.length === 0) return 0;

      const maxPainStrike = painByStrike.sort((a, b) => a.pain - b.pain)[0]
        .strike;
      // Return a directional "pull" score toward Max Pain
      return fastify.utilsPlugin.norm(maxPainStrike - spot, 150);
    };

    // 8. Greeks Composite Score
    const calcGreeksScore = (
      chain: FyersAPI.OptionChainData[],
      spot: number,
    ) => {
      const atm = getATM(chain, spot);

      if (atm.delta === null || atm.gamma === null) return null;

      let deltaP = 0;
      let deltaC = 0;
      let gammaSupport = 0;
      let gammaResistance = 0;

      for (const row of chain) {
        const delta = row.greeks?.delta ?? 0;
        const gammaOi = (row.greeks?.gamma ?? 0) * (row.oi ?? 0);

        if (row.option_type === OptionType.PE && row.strike_price < spot) {
          deltaP += delta;
          gammaSupport += gammaOi;
        }

        if (row.option_type === OptionType.CE && row.strike_price > spot) {
          deltaC += delta;
          gammaResistance += gammaOi;
        }
      }

      // Adjusted scales for Greek magnitudes
      const deltaScore = fastify.utilsPlugin.norm(deltaP - deltaC, 2);
      const gammaImbalance = gammaSupport - gammaResistance;
      const gammaScale = Math.max(
        1,
        (gammaSupport + gammaResistance) / 4,
      );
      const gammaScore = fastify.utilsPlugin.norm(gammaImbalance, gammaScale);
      const vegaScore =
        atm.vega !== null ? fastify.utilsPlugin.norm(10 - atm.vega, 5) : 0;
      const thetaScore =
        atm.theta !== null ? fastify.utilsPlugin.norm(0 - atm.theta, 5) : 0;

      return (
        0.35 * deltaScore +
        0.35 * gammaScore +
        0.15 * vegaScore +
        0.15 * thetaScore
      );
    };

    // 9. VIX Score
    const calcVixScore = (vix: number) => {
      const normalized = (vix - 15) / 10;
      return Math.tanh(normalized);
    };

    // 10. Trend Confirmation (price move + OI confirmation)
    // For intraday/scalper we want this to fire on smaller but clean moves.
    const calcTrendConfirmationScore = (
      chain: FyersAPI.OptionChainData[],
      spotChangePercent: number,
      sensitivity: 'aggressive' | 'normal' = 'normal',
    ) => {
      // Filter out noise strikes (lower bar for aggressive)
      const minOi = sensitivity === 'aggressive' ? 3000 : 5000;
      const filtered = chain.filter((r) => (r.oi ?? 0) > minOi);

      // Net OI change across meaningful strikes
      const netOIChange = filtered.reduce((sum, r) => sum + (r.oich ?? 0), 0);

      // Price thresholds for NIFTY (tighter for aggressive/scalper)
      const priceThresh = sensitivity === 'aggressive' ? 0.012 : 0.02;
      const priceUp = spotChangePercent > priceThresh;
      const priceDown = spotChangePercent < -priceThresh;

      // OI thresholds (slightly lower bar for aggressive)
      const oiThresh = sensitivity === 'aggressive' ? 3500 : 5000;
      const oiUp = netOIChange > oiThresh;
      const oiDown = netOIChange < -oiThresh;

      let raw = 0;

      if (priceUp && oiUp)
        raw = 1.0; // Long buildup
      else if (priceDown && oiUp)
        raw = -1.0; // Short buildup
      else if (priceUp && oiDown)
        raw = 0.5; // Short covering
      else if (priceDown && oiDown)
        raw = -0.5; // Long unwinding
      else raw = 0;

      return fastify.utilsPlugin.norm(raw, 1);
    };

    fastify.decorate('metricCalculationPlugin', {
      filterNearbyStrikes,
      calcOiPressure,
      calcPcrScore,
      calcSkewScore,
      calcAtmIvScore,
      calcMaxPainScore,
      calcGreeksScore,
      calcVixScore,
      calcTrendConfirmationScore,
    });
  },
  { name: 'metricCalculationPlugin' },
);
