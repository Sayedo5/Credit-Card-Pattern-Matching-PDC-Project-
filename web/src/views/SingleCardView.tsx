import { useMemo, useState } from 'react';
import { CircleCheck, CircleX, ScanLine } from 'lucide-react';
import { CARD_BRANDS, formatLengths, matchBrand, validateCard } from '../core';
import { BrandMark } from '../components/BrandMark';
import { CardNumberInput } from '../components/CardNumberInput';

/** Menu option 1 — Interactive Mode (Single Card). */
export function SingleCardView() {
  const [name, setName] = useState('John Doe');
  const [number, setNumber] = useState('4578723572619063');
  const [cvv, setCvv] = useState('123');
  const [expiry, setExpiry] = useState('12/30');

  const brand = useMemo(() => matchBrand(number).brand, [number]);
  const report = useMemo(() => validateCard(number, cvv, expiry), [number, cvv, expiry]);
  const hasInput = number.length > 0;

  function loadSample(sample: string) {
    setNumber(sample);
    const sampleBrand = matchBrand(sample).brand;
    setCvv(sampleBrand?.id === 'amex' ? '1234' : '123');
  }

  function handleExpiry(raw: string) {
    const digits = raw.replace(/\D/g, '').slice(0, 4);
    setExpiry(digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits);
  }

  return (
    <div className="view">
      <header className="view__header">
        <h2>Interactive Mode</h2>
        <p>
          One card through all four checks — Luhn checksum, CVV, expiry, and the prefix pattern
          table. Results update as you type.
        </p>
      </header>

      <div className="split">
        <form className="form" onSubmit={(event) => event.preventDefault()}>
          <div className="form__row">
            <label className="field-label" htmlFor="sc-name">
              Name on card
            </label>
            <div className="field">
              <input id="sc-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
          </div>

          <div className="form__row">
            <label className="field-label" htmlFor="sc-number">
              Card number
            </label>
            <CardNumberInput
              id="sc-number"
              value={number}
              onChange={setNumber}
              adornment={brand ? <BrandMark brand={brand} size="sm" /> : null}
            />
          </div>

          <div className="form__grid">
            <div className="form__row">
              <label className="field-label" htmlFor="sc-cvv">
                CVV {brand?.id === 'amex' && <span className="hint">4 digits</span>}
              </label>
              <div className="field">
                <input
                  id="sc-cvv"
                  inputMode="numeric"
                  value={cvv}
                  maxLength={4}
                  onChange={(e) => setCvv(e.target.value.replace(/\D/g, ''))}
                />
              </div>
            </div>

            <div className="form__row">
              <label className="field-label" htmlFor="sc-expiry">
                Expiry (MM/YY)
              </label>
              <div className="field">
                <input
                  id="sc-expiry"
                  inputMode="numeric"
                  value={expiry}
                  placeholder="12/30"
                  onChange={(e) => handleExpiry(e.target.value)}
                />
              </div>
            </div>
          </div>

          <button className="button" type="submit" disabled={!hasInput}>
            <ScanLine size={18} strokeWidth={2} aria-hidden />
            Check Pattern
          </button>
        </form>

        <div className="results" role="status" aria-live="polite">
          {!hasInput ? (
            <div className="result result--idle">
              <div className="result__body">
                <span className="result__title">Enter a card number to check</span>
              </div>
            </div>
          ) : (
            <>
              <div className={`result ${report.valid ? 'result--ok' : 'result--bad'}`}>
                <span className="result__icon">
                  {report.valid ? (
                    <CircleCheck size={30} strokeWidth={2} aria-hidden />
                  ) : (
                    <CircleX size={30} strokeWidth={2} aria-hidden />
                  )}
                </span>
                <div className="result__body">
                  <span className="result__title">
                    {report.valid ? 'Pattern Matched' : 'No Matching Pattern Found'}
                  </span>
                  {report.brand ? (
                    <>
                      <span className="result__brand">
                        <BrandMark brand={report.brand} />
                        {report.brand.name}
                      </span>
                      <span className="result__meta">
                        Prefix {report.brand.prefixLabel} &middot;{' '}
                        {formatLengths(report.brand.lengths)} digits
                      </span>
                    </>
                  ) : (
                    <span className="result__meta">
                      {report.nearMiss
                        ? `Prefix matches ${report.nearMiss.name}, but that network uses ${formatLengths(
                            report.nearMiss.lengths,
                          )} digits — this number has ${number.length}.`
                        : `No issuer pattern covers this prefix at ${number.length} digit${
                            number.length === 1 ? '' : 's'
                          }.`}
                    </span>
                  )}
                </div>
              </div>

              <ul className="checklist">
                <CheckRow label="Card number" ok={report.number.ok} message={report.number.message} />
                <CheckRow label="Luhn algorithm" ok={report.luhnValid} message={report.luhnValid ? 'Checksum passes' : 'Checksum fails'} />
                <CheckRow label="CVV" ok={report.cvv.ok} message={report.cvv.message} />
                <CheckRow label="Expiry" ok={report.expiry.ok} message={report.expiry.message} />
                <CheckRow
                  label="Card type"
                  ok={report.brand !== null}
                  message={report.brand?.name ?? 'Unknown'}
                />
              </ul>

              {name.trim() && <p className="footnote">Cardholder: {name.trim()}</p>}
            </>
          )}
        </div>
      </div>

      <section className="supported">
        <span className="supported__title">
          {CARD_BRANDS.length} networks in the pattern table &mdash; tap to try
        </span>
        <div className="supported__list">
          {CARD_BRANDS.map((b) => (
            <button
              key={b.id}
              type="button"
              className="supported__item"
              onClick={() => loadSample(b.sample)}
              title={`${b.name} — starts with ${b.prefixLabel}, ${formatLengths(b.lengths)} digits`}
            >
              <BrandMark brand={b} size="sm" title="" />
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function CheckRow({ label, ok, message }: { label: string; ok: boolean; message: string }) {
  return (
    <li className={`checklist__row ${ok ? 'is-ok' : 'is-bad'}`}>
      <span className="checklist__icon">
        {ok ? <CircleCheck size={16} strokeWidth={2.4} /> : <CircleX size={16} strokeWidth={2.4} />}
      </span>
      <span className="checklist__label">{label}</span>
      <span className="checklist__message">{message}</span>
    </li>
  );
}
