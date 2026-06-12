import { FYERS_OPTION_INDEX_SYMBOLS } from '../constants/fyers-symbols';

const UNDERLYING_PATTERNS: Array<{ pattern: RegExp; underlying: string }> = [
  { pattern: /NIFTYNXT50/i, underlying: 'NIFTYNXT50' },
  { pattern: /NIFTYBANK|BANKNIFTY/i, underlying: 'BANKNIFTY' },
  { pattern: /MIDCPNIFTY/i, underlying: 'MIDCPNIFTY' },
  { pattern: /FINNIFTY/i, underlying: 'FINNIFTY' },
  { pattern: /NIFTY/i, underlying: 'NIFTY' },
  { pattern: /SENSEX/i, underlying: 'SENSEX' },
  { pattern: /BANKEX/i, underlying: 'BANKEX' },
];

export function parseFyersIstDateTime(value: string): number {
  const monthMap: Record<string, string> = {
    Jan: '01',
    Feb: '02',
    Mar: '03',
    Apr: '04',
    May: '05',
    Jun: '06',
    Jul: '07',
    Aug: '08',
    Sep: '09',
    Oct: '10',
    Nov: '11',
    Dec: '12',
  };

  const [datePart, timePart] = value.trim().split(/\s+/);
  const [day, mon, year] = datePart.split('-');
  const month = monthMap[mon];
  if (!month || !timePart) {
    return NaN;
  }

  return new Date(
    `${year}-${month}-${day.padStart(2, '0')}T${timePart}+05:30`,
  ).getTime();
}

export function getIstSessionDate(epochMs: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(epochMs));
}

const STRIKE_PARSE_UNDERLYINGS = [
  'NIFTYNXT50',
  'NIFTYBANK',
  'BANKNIFTY',
  'MIDCPNIFTY',
  'FINNIFTY',
  'NIFTY',
  'SENSEX',
  'BANKEX',
] as const;

/** Parse strike from Fyers option symbology, e.g. NSE:NIFTY2661623200CE → 23200. */
export function parseStrikeFromFyersOptionSymbol(optionSymbol: string): number | null {
  const token = optionSymbol.split(':').pop()?.toUpperCase() ?? '';
  if (!token.endsWith('CE') && !token.endsWith('PE')) return null;

  const withoutSuffix = token.slice(0, -2);
  const underlying =
    STRIKE_PARSE_UNDERLYINGS.find((name) => withoutSuffix.startsWith(name)) ??
    null;
  if (!underlying) return null;

  const rest = withoutSuffix.slice(underlying.length);
  if (!rest || !/^\d+$/.test(rest)) return null;

  for (const strikeLen of [5, 4, 6]) {
    if (rest.length <= strikeLen) continue;
    const strikePart = rest.slice(-strikeLen);
    const expiryPart = rest.slice(0, -strikeLen);
    if (!/^\d+$/.test(strikePart) || !/^\d+$/.test(expiryPart)) continue;
    if (expiryPart.length < 4) continue;

    const strike = Number(strikePart);
    if (Number.isFinite(strike) && strike > 0) return strike;
  }

  return null;
}

export function resolveOptionMeta(optionSymbol: string): {
  underlying: string;
  indexSymbol: string;
  optionType: 'CE' | 'PE';
} | null {
  const upper = optionSymbol.toUpperCase();
  const optionType = upper.endsWith('CE')
    ? 'CE'
    : upper.endsWith('PE')
      ? 'PE'
      : null;

  if (!optionType) return null;

  const underlying =
    UNDERLYING_PATTERNS.find((item) => item.pattern.test(upper))?.underlying ??
    null;

  if (!underlying) return null;

  const indexMeta = FYERS_OPTION_INDEX_SYMBOLS.find(
    (item) => item.underlying === underlying,
  );

  if (!indexMeta) return null;

  return {
    underlying,
    indexSymbol: indexMeta.symbol,
    optionType,
  };
}