import { fyersModel, FyersAPI } from 'fyers-api-v3';
import { ResponseStatus } from '../types/common';
import { OptionType } from '../types/options';

export interface AtmOptionContext {
  strike: number;
  premium: number;
  delta: number | null;
  optionType: 'CE' | 'PE';
}

function nearestAtmStrike(
  chain: FyersAPI.OptionChainData[],
  spot: number,
): number {
  const strikes = [...new Set(chain.map((row) => row.strike_price))];
  return strikes.reduce((best, strike) =>
    Math.abs(strike - spot) < Math.abs(best - spot) ? strike : best,
  );
}

export async function fetchAtmOptionContext(
  fyers: Pick<fyersModel, 'getOptionChain'>,
  symbol: string,
  optionType: 'CE' | 'PE',
): Promise<AtmOptionContext | null> {
  const response = await fyers.getOptionChain({
    symbol,
    strikecount: 5,
    timestamp: '',
    greeks: 1,
  });

  if (response.s !== ResponseStatus.ok || !response.data?.optionsChain?.length) {
    return null;
  }

  const [spotRow, ...optionRows] = response.data.optionsChain;
  const spot = spotRow?.ltp ?? 0;
  if (spot <= 0 || optionRows.length === 0) return null;

  const atmStrike = nearestAtmStrike(optionRows, spot);
  const typeFilter =
    optionType === 'CE' ? OptionType.CE : OptionType.PE;
  const atmRow = optionRows.find(
    (row: FyersAPI.OptionChainData) =>
      row.strike_price === atmStrike && row.option_type === typeFilter,
  );

  if (!atmRow || atmRow.ltp <= 0) return null;

  return {
    strike: atmStrike,
    premium: atmRow.ltp,
    delta:
      atmRow.greeks?.delta != null
        ? Math.abs(atmRow.greeks.delta)
        : null,
    optionType,
  };
}