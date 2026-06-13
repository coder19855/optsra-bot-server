import { OptionIndexSymbol } from '../types/fyers-symbols';

/**
 * NSE/BSE index symbols with listed index options, sourced from Fyers symbol master:
 * - Spot/index: https://public.fyers.in/sym_details/NSE_CM.csv / BSE_CM.csv
 * - F&O lot sizes: https://public.fyers.in/sym_details/NSE_FO.csv / BSE_FO.csv
 *
 * Fyers symbology uses `{EXCHANGE}:{NAME}-INDEX` for index spot/history/option-chain.
 * Note: Bank Nifty is `NSE:NIFTYBANK-INDEX` (not BANKNIFTY-INDEX).
 */
export const FYERS_OPTION_INDEX_SYMBOLS: OptionIndexSymbol[] = [
  {
    id: 'nifty50',
    label: 'Nifty 50',
    shortName: 'NIFTY',
    symbol: 'NSE:NIFTY50-INDEX',
    exchange: 'NSE',
    underlying: 'NIFTY',
    lotSize: 65,
    tickSize: 0.05,
  },
  {
    id: 'banknifty',
    label: 'Nifty Bank',
    shortName: 'BANKNIFTY',
    symbol: 'NSE:NIFTYBANK-INDEX',
    exchange: 'NSE',
    underlying: 'BANKNIFTY',
    lotSize: 30,
    tickSize: 0.2,
  },
  {
    id: 'finnifty',
    label: 'Nifty Financial Services',
    shortName: 'FINNIFTY',
    symbol: 'NSE:FINNIFTY-INDEX',
    exchange: 'NSE',
    underlying: 'FINNIFTY',
    lotSize: 60,
    tickSize: 0.1,
  },
  {
    id: 'midcpnifty',
    label: 'Nifty Midcap Select',
    shortName: 'MIDCPNIFTY',
    symbol: 'NSE:MIDCPNIFTY-INDEX',
    exchange: 'NSE',
    underlying: 'MIDCPNIFTY',
    lotSize: 120,
    tickSize: 0.05,
  },
  {
    id: 'niftynxt50',
    label: 'Nifty Next 50',
    shortName: 'NIFTYNXT50',
    symbol: 'NSE:NIFTYNXT50-INDEX',
    exchange: 'NSE',
    underlying: 'NIFTYNXT50',
    lotSize: 25,
    tickSize: 0.2,
  },
  {
    id: 'sensex',
    label: 'S&P BSE Sensex',
    shortName: 'SENSEX',
    symbol: 'BSE:SENSEX-INDEX',
    exchange: 'BSE',
    underlying: 'SENSEX',
    lotSize: 20,
    tickSize: 0.05,
  },
  {
    id: 'bankex',
    label: 'S&P BSE Bankex',
    shortName: 'BANKEX',
    symbol: 'BSE:BANKEX-INDEX',
    exchange: 'BSE',
    underlying: 'BANKEX',
    lotSize: 30,
    tickSize: 0.05,
  },
];