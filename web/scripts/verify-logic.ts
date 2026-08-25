/*
 * Regression check for the ported notebook logic.
 *
 *   npm run verify
 *
 * No test framework: this is a plain script Vite bundles for Node, so the
 * project keeps a one-command correctness check without another dependency.
 */
import {
  CARD_BRANDS,
  detectCardType,
  formatCardNumber,
  formatLengths,
  generateTestData,
  luhnCheck,
  matchBrand,
  runGpu,
  runSerial,
  splitChunks,
  summarize,
  validateCard,
  validateCardNumber,
  validateCvv,
  validateExpiry,
} from '../src/core';

let fails = 0;
const check = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(42)} ${JSON.stringify(got)}` +
      (ok ? '' : `   expected ${JSON.stringify(want)}`),
  );
};

/* ---- 1. the notebook's own STEP 7 quick test ---- */
console.log('--- notebook STEP 7: quick test (its recorded output) ---');
const nb = validateCard('4578723572619063', '123', '12/25', new Date('2025-12-18T11:01:00'));
check('card number ok', nb.number.ok, true);
check('cvv ok', nb.cvv.ok, true);
check('expiry ok', nb.expiry.ok, true);
check('overall valid', nb.valid, true);
check('card type = Visa', nb.brand?.name, 'Visa');
check('expiry message', nb.expiry.message, 'Valid expiry until 12/2025');

/* ---- 2. reference table, one hit per rule branch ---- */
console.log('\n--- reference pattern table ---');
const cases: [string, string][] = [
  ['4111111111111111', 'Visa'],
  ['4222222222222', 'Visa'],
  ['5105105105105100', 'MasterCard'],
  ['2221000000000009', 'MasterCard'],
  ['2720999999999996', 'MasterCard'],
  ['341111111111111', 'American Express'],
  ['378282246310005', 'American Express'],
  ['3528000000000007', 'JCB'],
  ['3589000000000000', 'JCB'],
  ['30000000000004', 'Diners Club'],
  ['30569309025904', 'Diners Club'],
  ['36000000000008', 'Diners Club'],
  ['38000000000006', 'Diners Club'],
  ['6011111111111117', 'Discover'],
  ['6221260000000000', 'Discover'],
  ['6229250000000000', 'Discover'],
  ['6440000000000000', 'Discover'],
  ['6490000000000000', 'Discover'],
  ['6500000000000000', 'Discover'],
  ['6200000000000000', 'UnionPay'],
  ['620000000000000000', 'UnionPay'],
  ['5000000000000', 'Maestro'],
  ['580000000000', 'Maestro'],
  ['5600000000000000000', 'Maestro'],
  ['6759649826438453', 'Maestro'],
  // boundary rejections
  ['2220000000000000', 'Unknown'],
  ['2721000000000000', 'Unknown'],
  ['3527000000000000', 'Unknown'],
  ['3590000000000000', 'Unknown'],
  ['30600000000000', 'Unknown'],
  ['41111111111111', 'Unknown'],
  ['34111111111111', 'Unknown'],
  ['1234567890123456', 'Unknown'],
];
for (const [number, expected] of cases) {
  check(`detectCardType ${number}`, detectCardType(number), expected);
}

/* ---- 3. the four validators ---- */
console.log('\n--- validators ---');
check('luhn valid', luhnCheck('4111111111111111'), true);
check('luhn invalid', luhnCheck('4111111111111112'), false);
check('number too short', validateCardNumber('411111111').ok, false);
check('number non-numeric', validateCardNumber('4111-XXXX').ok, false);
check('cvv 3 digits', validateCvv('123').ok, true);
check('cvv 4 digits (non-amex)', validateCvv('1234').ok, false);
check('cvv 4 digits (amex)', validateCvv('1234', CARD_BRANDS[2]).ok, true);
check('cvv 3 digits (amex)', validateCvv('123', CARD_BRANDS[2]).ok, false);
const now = new Date('2026-08-26T00:00:00');
check('expiry future', validateExpiry('12/30', now).ok, true);
check('expiry past year', validateExpiry('01/20', now).ok, false);
check('expiry same year past month', validateExpiry('07/26', now).ok, false);
check('expiry same year same month', validateExpiry('08/26', now).ok, true);
check('expiry month 13', validateExpiry('13/30', now).ok, false);
check('expiry bad format', validateExpiry('2030-12', now).ok, false);

/* ---- 4. near-miss reporting ---- */
console.log('\n--- near miss ---');
check('34-prefix at 14 digits', matchBrand('34111111111111').nearMiss?.name, 'American Express');
check('matched card has no near miss', matchBrand('4111111111111111').nearMiss, null);

/* ---- 5. generateTestData produces valid cards ---- */
console.log('\n--- generate_test_data port ---');
const generated = generateTestData(2000, { seed: 42 });
check('count', generated.length, 2000);
check('all lengths 12-19', generated.every((c) => c.number.length >= 12 && c.number.length <= 19), true);
check('all Luhn-valid', generated.every((c) => luhnCheck(c.number)), true);
check('cvv 3 or 4 digits', generated.every((c) => /^\d{3,4}$/.test(c.cvv)), true);
check('amex cards get 4-digit cvv', generated.filter((c) => matchBrand(c.number).brand?.id === 'amex').every((c) => c.cvv.length === 4), true);
check('all expiry MM/YY', generated.every((c) => /^\d{2}\/\d{2}$/.test(c.expiry)), true);
check('deterministic for a seed', generateTestData(5, { seed: 7 })[4].number, generateTestData(5, { seed: 7 })[4].number);
check('every card matches a brand', generated.every((c) => matchBrand(c.number).brand !== null), true);
check('lengths are brand-legal', generated.every((c) => CARD_BRANDS.some((b) => b.lengths.includes(c.number.length))), true);
check('all expiries in the future', generated.every((c) => validateExpiry(c.expiry).ok), true);
check('invalidRate 0.2 breaks ~20%', Math.abs(generateTestData(4000, { seed: 3, invalidRate: 0.2 }).filter((c) => !luhnCheck(c.number)).length / 4000 - 0.2) < 0.03, true);

/* ---- 6. chunking matches the notebook ---- */
console.log('\n--- MPI chunking (notebook algorithm) ---');
check('1000 over 4', splitChunks(Array.from({ length: 1000 }, (_, i) => i), 4).map((c) => c.length), [250, 250, 250, 250]);
check('1003 over 4 (remainder to last)', splitChunks(Array.from({ length: 1003 }, (_, i) => i), 4).map((c) => c.length), [250, 250, 250, 253]);
check('7 over 3', splitChunks([1, 2, 3, 4, 5, 6, 7], 3).map((c) => c.length), [2, 2, 3]);
const chunked = splitChunks(Array.from({ length: 1003 }, (_, i) => i), 4).flat();
check('gather preserves order', chunked.every((v, i) => v === i), true);

/* ---- 7. engines agree ---- */
console.log('\n--- engines ---');
const batch = generateTestData(5000, { seed: 99 });
const serial = runSerial(batch);
const gpu = runGpu(batch);
check('serial count', serial.results.length, 5000);
check('serial == gpu results', JSON.stringify(serial.results) === JSON.stringify(gpu.results), true);
check('all generated cards valid', serial.results.every((r) => r.valid), true);
const sum = summarize(serial.results);
check('summary total', sum.total, 5000);
check('summary success rate', sum.successRate, 100);
check('type distribution sums to valid', sum.byType.reduce((a, b) => a + b.count, 0), sum.valid);
console.log('     brands seen:', sum.byType.map((t) => `${t.type}=${t.count}`).join(', '));

/* ---- 8. formatting ---- */
console.log('\n--- formatting ---');
check('visa grouping', formatCardNumber('4111111111111111'), '4111 1111 1111 1111');
check('amex 4-6-5', formatCardNumber('378282246310005'), '3782 822463 10005');
check('lengths 13/16', formatLengths([13, 16]), '13 or 16');
check('lengths 12-19', formatLengths([12, 13, 14, 15, 16, 17, 18, 19]), '12–19');

/* ---- 9. brand table integrity ---- */
console.log('\n--- brand table ---');
check('8 brands', CARD_BRANDS.length, 8);
check('all samples Luhn-valid', CARD_BRANDS.every((b) => luhnCheck(b.sample)), true);
check('all samples self-identify', CARD_BRANDS.every((b) => matchBrand(b.sample).brand?.id === b.id), true);
check('all prefix bounds match digit width', CARD_BRANDS.every((b) => b.prefixes.every((p) => String(p.from).length === p.digits && String(p.to).length === p.digits)), true);

console.log(`\n${fails === 0 ? 'ALL CHECKS PASSED' : `${fails} FAILURE(S)`}`);
if (fails > 0) process.exitCode = 1;
