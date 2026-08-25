/*
 * card_patterns.cuh — the matching algorithm itself.
 *
 * This is the single source of truth for the project. Everything else (the
 * FastAPI server, the React front end) is transport and presentation.
 *
 * Ported from CreditCardSystem in PDC_Project.ipynb, which does two things:
 *
 *   1. validate_card_number() -> the Luhn checksum
 *   2. detect_card_type()     -> prefix matching, in two shapes that are
 *                                really the same operation:
 *
 *          card_number.startswith('4')          # first 1 digit  == 4
 *          51 <= int(card_number[:2]) <= 55     # first 2 digits in [51, 55]
 *
 * A startswith is just the range where `from == to`, so both collapse into
 * "slice the first N digits, read as an integer, test a closed range". That
 * is CmPrefixRange below, and it is why adding a card network is a new row in
 * the table rather than a new branch in the code.
 *
 * Every function is __host__ __device__ so the GPU kernel and the CPU
 * reference path (used for the speedup benchmark) run *the same code*. There
 * is no second implementation to drift out of sync.
 *
 * Digits are passed as ASCII characters, never as an integer. The kernel
 * sketch in the notebook's generate_cuda_kernel_code() used `long long
 * card_num` and did `temp % 10` arithmetic, which silently overflows: a
 * 19-digit Maestro or UnionPay number reaches ~1.0e19 and long long tops out
 * at ~9.22e18. Character arrays sidestep that entirely.
 */

#ifndef CARD_PATTERNS_CUH
#define CARD_PATTERNS_CUH

#ifdef __CUDACC__
#define CM_HD __host__ __device__
#else
#define CM_HD
#endif

/* Longest number in the reference table: UnionPay / Maestro at 19 digits. */
#define CM_MAX_LEN 19

/* Discover needs 4 prefix rules; Maestro needs 8 accepted lengths (12..19). */
#define CM_MAX_PREFIXES 4
#define CM_MAX_LENGTHS 8
#define CM_NUM_BRANDS 8

/* Brand indices. The order is the evaluation order — see cm_match(). */
#define CM_VISA 0
#define CM_MASTERCARD 1
#define CM_AMEX 2
#define CM_JCB 3
#define CM_DINERS 4
#define CM_DISCOVER 5
#define CM_UNIONPAY 6
#define CM_MAESTRO 7

/* "Take the first `digits` characters, read them as an int, test [from, to]." */
typedef struct {
  int digits;
  int from;
  int to;
} CmPrefixRange;

typedef struct {
  int numPrefixes;
  CmPrefixRange prefixes[CM_MAX_PREFIXES];
  int numLengths;
  int lengths[CM_MAX_LENGTHS];
} CmBrandRule;

/* ------------------------------------------------------------------ */
/* Luhn checksum — a direct port of validate_card_number()'s loop.     */
/* ------------------------------------------------------------------ */
CM_HD inline int cm_luhn(const char *digits, int len) {
  int total = 0;
  for (int i = 0; i < len; ++i) {
    int n = digits[len - 1 - i] - '0'; /* walk in reverse */
    if (i % 2 == 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    total += n;
  }
  return (total % 10) == 0;
}

/* First `n` digits as an integer. n <= 6 here, so this cannot overflow. */
CM_HD inline int cm_prefix_value(const char *digits, int n) {
  int v = 0;
  for (int i = 0; i < n; ++i) v = v * 10 + (digits[i] - '0');
  return v;
}

CM_HD inline int cm_prefix_matches(const CmBrandRule *r, const char *digits, int len) {
  for (int p = 0; p < r->numPrefixes; ++p) {
    int d = r->prefixes[p].digits;
    /* Guard short input: without this, "4" would satisfy a 2-digit rule. */
    if (len < d) continue;
    int v = cm_prefix_value(digits, d);
    if (v >= r->prefixes[p].from && v <= r->prefixes[p].to) return 1;
  }
  return 0;
}

CM_HD inline int cm_length_ok(const CmBrandRule *r, int len) {
  for (int i = 0; i < r->numLengths; ++i)
    if (r->lengths[i] == len) return 1;
  return 0;
}

/*
 * Walk the brands in order, first match wins — the same control flow as the
 * notebook's if/elif chain, just driven by the table.
 *
 * `outNearMiss` records the first brand whose *prefix* fit but whose length
 * did not, so the UI can say "that looks like a Visa but Visa is 13 or 16
 * digits" instead of a bare failure. Scanning continues after a near miss
 * because a later, broader brand may still accept the length.
 */
CM_HD inline void cm_match(const CmBrandRule *rules, const char *digits, int len,
                           int *outBrand, int *outNearMiss) {
  *outBrand = -1;
  *outNearMiss = -1;
  if (len <= 0 || len > CM_MAX_LEN) return;

  for (int b = 0; b < CM_NUM_BRANDS; ++b) {
    if (!cm_prefix_matches(&rules[b], digits, len)) continue;

    if (cm_length_ok(&rules[b], len)) {
      *outBrand = b;
      *outNearMiss = -1;
      return;
    }
    if (*outNearMiss < 0) *outNearMiss = b;
  }
}

#endif /* CARD_PATTERNS_CUH */
