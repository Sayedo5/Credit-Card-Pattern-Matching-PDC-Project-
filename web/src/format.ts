/*
 * Presentation helpers. Cosmetic only — nothing here decides whether a number
 * matches a brand, that is the GPU's job.
 */

/** Must match CM_MAX_LEN in cuda/card_patterns.cuh. */
export const MAX_DIGITS = 19;

export function toDigits(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, MAX_DIGITS);
}

/**
 * "4111111111111111" -> "4111 1111 1111 1111".
 *
 * Amex prints as 4-6-5, so the grouping keys off a 34/37 prefix. That is a
 * typography rule about how the number is laid out on the physical card, not
 * a brand decision — the backend is still the only thing that says "Amex".
 */
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
