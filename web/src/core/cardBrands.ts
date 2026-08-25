import type { CardBrand } from './types';

/**
 * Card brand pattern table.
 *
 * `detect_card_type` in PDC_Project.ipynb tests prefixes in exactly two shapes:
 *
 *     card_number.startswith('4')            # first 1 digit  == 4
 *     51 <= int(card_number[:2]) <= 55       # first 2 digits in [51, 55]
 *
 * Both are the same operation — slice the leading digits, read them as an
 * integer, test a closed range. A `startswith` is just the range where
 * `from === to`. This table is that comparison expressed as data, so a new
 * network is a new row rather than a new branch.
 *
 * The notebook covered four brands; the other four are additions.
 */

const range = (from: number, to: number): number[] => {
  const out: number[] = [];
  for (let n = from; n <= to; n++) out.push(n);
  return out;
};

/**
 * Ordered most-specific-first, mirroring the notebook's if/elif chain where
 * the broad `startswith('6')` test sat last so narrower tests got first
 * refusal. Maestro's blanket `6` now occupies that slot.
 */
export const CARD_BRANDS: CardBrand[] = [
  {
    id: 'visa',
    name: 'Visa',
    short: 'VISA',
    color: '#1a1f71',
    prefixLabel: '4',
    prefixes: [{ digits: 1, from: 4, to: 4 }],
    lengths: [13, 16],
    sample: '4111111111111111',
  },
  {
    id: 'mastercard',
    name: 'MasterCard',
    short: 'MC',
    color: '#eb001b',
    prefixLabel: '51–55, 2221–2720',
    prefixes: [
      { digits: 2, from: 51, to: 55 },
      { digits: 4, from: 2221, to: 2720 },
    ],
    lengths: [16],
    sample: '5555555555554444',
  },
  {
    id: 'amex',
    name: 'American Express',
    short: 'AMEX',
    color: '#006fcf',
    prefixLabel: '34, 37',
    prefixes: [
      { digits: 2, from: 34, to: 34 },
      { digits: 2, from: 37, to: 37 },
    ],
    lengths: [15],
    sample: '378282246310005',
  },
  {
    id: 'jcb',
    name: 'JCB',
    short: 'JCB',
    color: '#0b4ea2',
    prefixLabel: '3528–3589',
    prefixes: [{ digits: 4, from: 3528, to: 3589 }],
    lengths: [16],
    sample: '3566002020360505',
  },
  {
    id: 'diners',
    name: 'Diners Club',
    short: 'DINERS',
    color: '#0079be',
    prefixLabel: '300–305, 36, 38',
    prefixes: [
      { digits: 3, from: 300, to: 305 },
      { digits: 2, from: 36, to: 36 },
      { digits: 2, from: 38, to: 38 },
    ],
    lengths: [14],
    sample: '30569309025904',
  },
  {
    // Ahead of UnionPay: 622126–622925 is the Discover-issued slice of the
    // 62 range, so the narrower six-digit rule must be tested first.
    id: 'discover',
    name: 'Discover',
    short: 'DISC',
    color: '#ff6000',
    prefixLabel: '6011, 622126–622925, 644–649, 65',
    prefixes: [
      { digits: 4, from: 6011, to: 6011 },
      { digits: 6, from: 622126, to: 622925 },
      { digits: 3, from: 644, to: 649 },
      { digits: 2, from: 65, to: 65 },
    ],
    lengths: [16],
    sample: '6011111111111117',
  },
  {
    id: 'unionpay',
    name: 'UnionPay',
    short: 'UNIONPAY',
    color: '#e21836',
    prefixLabel: '62',
    prefixes: [{ digits: 2, from: 62, to: 62 }],
    lengths: range(16, 19),
    sample: '6200000000000005',
  },
  {
    // The broad `6` rule — last, the way the notebook kept its own catch-all last.
    id: 'maestro',
    name: 'Maestro',
    short: 'MAESTRO',
    color: '#6c6bbd',
    prefixLabel: '50, 56–58, 6',
    prefixes: [
      { digits: 2, from: 50, to: 50 },
      { digits: 2, from: 56, to: 58 },
      { digits: 1, from: 6, to: 6 },
    ],
    lengths: range(12, 19),
    sample: '6759649826438453',
  },
];

/** Longest number in the table: UnionPay / Maestro at 19 digits. */
export const MAX_DIGITS = 19;
/** Shortest: Maestro at 12. */
export const MIN_DIGITS = 12;
