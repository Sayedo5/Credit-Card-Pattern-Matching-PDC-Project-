/*
 * Direct port of CreditCardSystem from PDC_Project.ipynb (STEP 2).
 *
 * Function-for-function:
 *   validate_card_number -> validateCardNumber   (Luhn + length)
 *   validate_cvv         -> validateCvv
 *   validate_expiry      -> validateExpiry
 *   detect_card_type     -> detectCardType
 *
 * Two deliberate changes, both documented in the README:
 *
 *   1. The notebook gates on `^\d{16}$`. That made American Express
 *      unreachable — 34/37 numbers are 15 digits and were rejected before
 *      detect_card_type ever ran — and it cannot express Diners' 14. The
 *      length rule is now per-brand.
 *   2. detect_card_type covered four networks; the table now holds eight.
 *
 * Neither changes the *approach*: Luhn plus ordered prefix-range tests, first
 * match wins. There is no regex in the brand detection path.
 */

import { CARD_BRANDS, MAX_DIGITS, MIN_DIGITS } from './cardBrands';
import type { CardBrand, CheckResult, PrefixRange, ValidationReport } from './types';

/** The notebook's `.strip().replace(" ", "").replace("-", "")`. */
export function normalizeCardNumber(raw: string): string {
  return String(raw).trim().replace(/[\s-]/g, '');
}

export function toDigits(raw: string): string {
  return String(raw).replace(/\D/g, '').slice(0, MAX_DIGITS);
}

/**
 * Luhn checksum — the notebook's loop, unchanged. Walk the digits in reverse,
 * double every second one, subtract 9 when a doubled digit exceeds 9, and
 * check the total is divisible by 10.
 */
export function luhnCheck(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;

  let total = 0;
  const reverseDigits = digits.split('').reverse();

  for (let i = 0; i < reverseDigits.length; i++) {
    let n = Number(reverseDigits[i]);
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    total += n;
  }

  return total % 10 === 0;
}

/* ------------------------------------------------------------------ */
/* Prefix matching                                                     */
/* ------------------------------------------------------------------ */

function prefixMatches(digits: string, rule: PrefixRange): boolean {
  // Guard short input: without this, "4" would satisfy a 2-digit rule.
  if (digits.length < rule.digits) return false;
  const value = Number(digits.slice(0, rule.digits));
  return value >= rule.from && value <= rule.to;
}

function brandPrefixMatches(digits: string, brand: CardBrand): boolean {
  return brand.prefixes.some((rule) => prefixMatches(digits, rule));
}

export type BrandMatch = {
  brand: CardBrand | null;
  /** First brand whose prefix fit but whose length did not. */
  nearMiss: CardBrand | null;
};

/**
 * The generalized `detect_card_type`. Walks the brands in order and returns
 * the first whose prefix rule fires *and* whose length rule accepts.
 *
 * Scanning continues past a near miss because a later, broader brand may
 * still accept that length.
 */
export function matchBrand(rawInput: string): BrandMatch {
  const digits = normalizeCardNumber(rawInput);
  if (!/^\d+$/.test(digits)) return { brand: null, nearMiss: null };

  let nearMiss: CardBrand | null = null;

  for (const brand of CARD_BRANDS) {
    if (!brandPrefixMatches(digits, brand)) continue;
    if (brand.lengths.includes(digits.length)) return { brand, nearMiss: null };
    if (!nearMiss) nearMiss = brand;
  }

  return { brand: null, nearMiss };
}

/** The notebook's `detect_card_type` return shape: a name, or "Unknown". */
export function detectCardType(cardNumber: string): string {
  return matchBrand(cardNumber).brand?.name ?? 'Unknown';
}

/* ------------------------------------------------------------------ */
/* The three validators                                                */
/* ------------------------------------------------------------------ */

export function validateCardNumber(raw: string): CheckResult & { cleaned: string | null } {
  const cleaned = normalizeCardNumber(raw);

  if (!/^\d+$/.test(cleaned)) {
    return { ok: false, message: 'Card number must contain digits only', cleaned: null };
  }
  if (cleaned.length < MIN_DIGITS || cleaned.length > MAX_DIGITS) {
    return {
      ok: false,
      message: `Card number must be ${MIN_DIGITS}–${MAX_DIGITS} digits (got ${cleaned.length})`,
      cleaned: null,
    };
  }
  if (!luhnCheck(cleaned)) {
    return { ok: false, message: 'Invalid card number (Luhn check failed)', cleaned: null };
  }

  return { ok: true, message: `Valid ${cleaned.length}-digit card number`, cleaned };
}

/**
 * The notebook requires exactly 3 digits. American Express prints a 4-digit
 * CID, so the expected length now follows the detected brand.
 */
export function validateCvv(raw: string, brand?: CardBrand | null): CheckResult {
  const cvv = String(raw).trim();
  const expected = brand?.id === 'amex' ? 4 : 3;

  if (!/^\d+$/.test(cvv)) {
    return { ok: false, message: 'CVV must contain digits only' };
  }
  if (cvv.length !== expected) {
    const who = brand?.id === 'amex' ? ' for American Express' : '';
    return { ok: false, message: `CVV must be exactly ${expected} digits${who}` };
  }
  return { ok: true, message: `Valid ${expected}-digit CVV` };
}

/** MM/YY, a real month, and not already past. Same rules as the notebook. */
export function validateExpiry(raw: string, now: Date = new Date()): CheckResult {
  const expiry = String(raw).trim();

  if (!/^\d{2}\/\d{2}$/.test(expiry)) {
    return { ok: false, message: 'Expiry must be in MM/YY format' };
  }

  const [month, year] = expiry.split('/').map(Number);
  const currentYear = now.getFullYear() % 100;
  const currentMonth = now.getMonth() + 1;

  if (month < 1 || month > 12) {
    return { ok: false, message: 'Month must be 01–12' };
  }
  if (year < currentYear || (year === currentYear && month < currentMonth)) {
    const mm = String(currentMonth).padStart(2, '0');
    const yy = String(currentYear).padStart(2, '0');
    return { ok: false, message: `Card expired (current: ${mm}/${yy})` };
  }

  const mm = String(month).padStart(2, '0');
  const yy = String(year).padStart(2, '0');
  return { ok: true, message: `Valid expiry until ${mm}/20${yy}` };
}

/**
 * All three checks plus brand detection, the way `process_single_card` runs
 * them together.
 */
export function validateCard(
  number: string,
  cvv: string,
  expiry: string,
  now?: Date,
): ValidationReport {
  const numberResult = validateCardNumber(number);
  const { brand, nearMiss } = matchBrand(number);
  const cvvResult = validateCvv(cvv, brand);
  const expiryResult = validateExpiry(expiry, now);

  return {
    number: numberResult,
    cvv: cvvResult,
    expiry: expiryResult,
    brand,
    nearMiss,
    luhnValid: luhnCheck(normalizeCardNumber(number)),
    valid: numberResult.ok && cvvResult.ok && expiryResult.ok && brand !== null,
  };
}

/* ------------------------------------------------------------------ */
/* Presentation helpers (cosmetic only)                                */
/* ------------------------------------------------------------------ */

/** "4111111111111111" -> "4111 1111 1111 1111". Amex groups 4-6-5. */
export function formatCardNumber(raw: string): string {
  const digits = toDigits(raw);
  const groups = /^3[47]/.test(digits) ? [4, 6, 5] : [4, 4, 4, 4, 4];

  const parts: string[] = [];
  let cursor = 0;
  for (const size of groups) {
    if (cursor >= digits.length) break;
    parts.push(digits.slice(cursor, cursor + size));
    cursor += size;
  }
  if (cursor < digits.length) parts.push(digits.slice(cursor));

  return parts.join(' ');
}

/** [12..19] renders as "12–19"; [13, 16] renders as "13 or 16". */
export function formatLengths(lengths: number[]): string {
  if (lengths.length === 0) return '';
  if (lengths.length === 1) return String(lengths[0]);

  const contiguous = lengths.every((n, i) => i === 0 || n === lengths[i - 1] + 1);
  if (contiguous && lengths.length > 2) {
    return `${lengths[0]}–${lengths[lengths.length - 1]}`;
  }
  return lengths.join(' or ');
}
