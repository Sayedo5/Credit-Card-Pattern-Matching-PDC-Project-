/*
 * Port of `generate_test_data` from PDC_Project.ipynb (STEP 2).
 *
 * The Luhn check-digit computation is the notebook's, unchanged. Two things
 * about *what* it generates had to change, because the notebook's version
 * produces data its own validator would reject:
 *
 *   1. It picks a prefix from ['4', '5', '37', '6'] and always builds a
 *      16-digit number. American Express is 15 digits, so every '37' card it
 *      made — a quarter of the batch — was a number no real network issues.
 *      The notebook never noticed because its detect_card_type ignores length.
 *      Here the prefix and the length are drawn together from the brand table,
 *      so a generated Amex is 15 digits and a generated Diners is 14.
 *
 *   2. Its expiry is `randint(current_year, current_year + 5)` with a random
 *      month, so any card landing on the current year with an earlier month is
 *      born expired — roughly 10% of every batch. Months are now constrained
 *      when the year is the current one.
 *
 * Net effect: batches are 100% valid by default, which is what the notebook's
 * comment ("Calculate check digit for valid cards") intended.
 */

import { CARD_BRANDS } from './cardBrands';
import type { CardRecord } from './types';

/** Deterministic PRNG so a given seed always yields the same batch. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The check digit that completes a card number — the notebook's loop verbatim.
 *
 * The appended digit lands at index 0 from the right, so walking the base
 * reversed, index 0 is the first *doubled* position — hence `j % 2 === 0`
 * here versus `i % 2 === 1` in the plain Luhn verifier.
 */
export function luhnCheckDigit(base: string): number {
  let total = 0;
  const reversed = base.split('').reverse();

  for (let j = 0; j < reversed.length; j++) {
    let n = Number(reversed[j]);
    if (j % 2 === 0) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    total += n;
  }

  return (10 - (total % 10)) % 10;
}

export type GenerateOptions = {
  seed?: number;
  /** Fraction of the batch deliberately broken, 0–1. Defaults to 0. */
  invalidRate?: number;
};

export function generateTestData(
  numCards: number,
  options: GenerateOptions | number = {},
): CardRecord[] {
  const { seed = 12345, invalidRate = 0 } =
    typeof options === 'number' ? { seed: options } : options;

  const random = mulberry32(seed);
  const randInt = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
  const pick = <T,>(items: T[]): T => items[randInt(0, items.length - 1)];

  const cards: CardRecord[] = [];
  const now = new Date();
  const currentYear = now.getFullYear() % 100;
  const currentMonth = now.getMonth() + 1;

  for (let i = 0; i < numCards; i++) {
    const brand = pick(CARD_BRANDS);
    const rule = pick(brand.prefixes);
    const length = pick(brand.lengths);

    // A real value from inside the rule's range, left-padded to its width.
    const prefix = String(randInt(rule.from, rule.to)).padStart(rule.digits, '0');

    let base = prefix;
    while (base.length < length - 1) base += String(randInt(0, 9));

    let number = base + String(luhnCheckDigit(base));

    // Break the checksum on the requested share of the batch.
    const shouldBreak = invalidRate > 0 && random() < invalidRate;
    if (shouldBreak) {
      const last = Number(number[number.length - 1]);
      number = number.slice(0, -1) + String((last + 1) % 10);
    }

    // Always in the future: constrain the month when the year is this one.
    const year = randInt(currentYear, currentYear + 5);
    const month = year === currentYear ? randInt(currentMonth, 12) : randInt(1, 12);

    cards.push({
      name: `Test User ${i + 1}`,
      number,
      cvv: String(randInt(brand.id === 'amex' ? 1000 : 100, brand.id === 'amex' ? 9999 : 999)),
      expiry: `${String(month).padStart(2, '0')}/${String(year).padStart(2, '0')}`,
    });
  }

  return cards;
}
