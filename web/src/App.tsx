import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CreditCard,
  CircleCheck,
  CircleX,
  ScanLine,
  Loader2,
  PlugZap,
  Cpu,
} from 'lucide-react';
import {
  checkHealth,
  fetchBrands,
  getApiUrl,
  matchCardNumber,
  setApiUrl,
  type ApiBrand,
  type MatchResponse,
} from './api';
import { formatCardNumber, formatLengths, MAX_DIGITS, toDigits } from './format';
import { BrandMark } from './components/BrandMark';

type Backend =
  | { state: 'connecting' }
  | { state: 'online'; device: string }
  | { state: 'offline'; reason: string };

/** How long to wait after the last keystroke before asking the GPU. */
const DEBOUNCE_MS = 300;

export default function App() {
  const [digits, setDigits] = useState('');
  const [backend, setBackend] = useState<Backend>({ state: 'connecting' });
  const [brands, setBrands] = useState<ApiBrand[]>([]);
  const [result, setResult] = useState<MatchResponse | null>(null);
  const [checking, setChecking] = useState(false);
  const [urlDraft, setUrlDraft] = useState(getApiUrl);
  const [editingUrl, setEditingUrl] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  /** Guards against a slow early response overwriting a newer one. */
  const requestSeq = useRef(0);

  const formatted = useMemo(() => formatCardNumber(digits), [digits]);
  const online = backend.state === 'online';

  /* ---------------- backend connection ---------------- */

  const connect = useCallback(async () => {
    setBackend({ state: 'connecting' });
    const base = getApiUrl();
    try {
      const [health, brandList] = await Promise.all([checkHealth(base), fetchBrands(base)]);
      setBrands(brandList.brands);
      setBackend({ state: 'online', device: health.device });
    } catch (error) {
      setBrands([]);
      setResult(null);
      setBackend({
        state: 'offline',
        reason: error instanceof Error ? error.message : 'unreachable',
      });
    }
  }, []);

  useEffect(() => {
    void connect();
  }, [connect]);

  /* ---------------- matching (always on the GPU) ---------------- */

  const runMatch = useCallback(
    async (value: string) => {
      if (!value) {
        setResult(null);
        return;
      }
      const seq = ++requestSeq.current;
      setChecking(true);
      try {
        const response = await matchCardNumber(getApiUrl(), value);
        if (seq === requestSeq.current) setResult(response);
      } catch (error) {
        if (seq === requestSeq.current) {
          setResult(null);
          setBackend({
            state: 'offline',
            reason: error instanceof Error ? error.message : 'request failed',
          });
        }
      } finally {
        if (seq === requestSeq.current) setChecking(false);
      }
    },
    [],
  );

  // Live result: re-ask the GPU shortly after typing stops.
  useEffect(() => {
    if (!online) return;
    if (!digits) {
      setResult(null);
      return;
    }
    const timer = setTimeout(() => void runMatch(digits), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [digits, online, runMatch]);

  /* ---------------- input handling ---------------- */

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const el = event.target;
    const caret = el.selectionStart ?? el.value.length;
    const inputType = (event.nativeEvent as InputEvent).inputType;

    let digitsBeforeCaret = el.value.slice(0, caret).replace(/\D/g, '').length;
    let next = toDigits(el.value);

    // Backspacing onto a separator space removes a character the user never
    // typed, so the digit count is unchanged and the field looks frozen. Take
    // the digit in front of the separator instead, which is what they meant.
    if (inputType === 'deleteContentBackward' && next.length === digits.length && digitsBeforeCaret > 0) {
      next = next.slice(0, digitsBeforeCaret - 1) + next.slice(digitsBeforeCaret);
      digitsBeforeCaret -= 1;
    }

    setDigits(next);

    // Put the caret back where it was, counted in digits so the spaces we
    // insert do not drag it around.
    const nextFormatted = formatCardNumber(next);
    let seen = 0;
    let nextCaret = nextFormatted.length;
    for (let i = 0; i < nextFormatted.length; i++) {
      if (seen === digitsBeforeCaret) {
        nextCaret = i;
        break;
      }
      if (/\d/.test(nextFormatted[i])) seen++;
    }
    requestAnimationFrame(() => el.setSelectionRange(nextCaret, nextCaret));
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!online) {
      void connect();
      return;
    }
    void runMatch(digits);
    inputRef.current?.focus();
  }

  function loadSample(sample: string) {
    setDigits(sample);
    inputRef.current?.focus();
  }

  function saveUrl(event: React.FormEvent) {
    event.preventDefault();
    setApiUrl(urlDraft);
    setEditingUrl(false);
    void connect();
  }

  const hasInput = digits.length > 0;

  return (
    <div className="page">
      <main className="panel">
        <header className="panel__header">
          <div className="logo">
            <CreditCard size={30} strokeWidth={1.75} aria-hidden />
          </div>
          <h1>Credit Card Pattern Matching</h1>
          <p className="subtitle">
            Card numbers are matched by a CUDA kernel running on the GPU. Nothing is matched in
            this browser.
          </p>
        </header>

        <form className="form" onSubmit={handleSubmit}>
          <label className="field-label" htmlFor="card-number">
            Card Number
          </label>

          <div className="field">
            <input
              id="card-number"
              ref={inputRef}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="4111 1111 1111 1111"
              value={formatted}
              onChange={handleChange}
              disabled={!online}
              aria-describedby="match-result"
            />
            {result?.brand ? (
              <span className="field__mark">
                <BrandMark brand={result.brand} size="sm" />
              </span>
            ) : (
              hasInput && <span className="field__count">{digits.length}</span>
            )}
          </div>

          <button className="button" type="submit" disabled={online && !hasInput}>
            {checking ? (
              <Loader2 size={18} strokeWidth={2} className="spin" aria-hidden />
            ) : online ? (
              <ScanLine size={18} strokeWidth={2} aria-hidden />
            ) : (
              <PlugZap size={18} strokeWidth={2} aria-hidden />
            )}
            {online ? 'Check Pattern' : 'Reconnect to GPU'}
          </button>
        </form>

        <div id="match-result" role="status" aria-live="polite" style={{ width: '100%' }}>
          {!online ? (
            <div className="result result--bad">
              <span className="result__icon">
                <CircleX size={30} strokeWidth={2} aria-hidden />
              </span>
              <div className="result__body">
                <span className="result__title">
                  {backend.state === 'connecting' ? 'Connecting to GPU backend…' : 'GPU backend offline'}
                </span>
                <span className="result__meta">
                  {backend.state === 'connecting'
                    ? getApiUrl()
                    : `Could not reach ${getApiUrl()} (${backend.reason}). Start the CUDA server in Colab, then paste its URL below.`}
                </span>
              </div>
            </div>
          ) : !hasInput ? (
            <div className="result result--idle">
              <span className="result__icon">
                <CreditCard size={26} strokeWidth={1.75} aria-hidden />
              </span>
              <div className="result__body">
                <span className="result__title">Enter a card number to check</span>
              </div>
            </div>
          ) : result?.matched && result.brand ? (
            <div className="result result--ok">
              <span className="result__icon">
                <CircleCheck size={30} strokeWidth={2} aria-hidden />
              </span>
              <div className="result__body">
                <span className="result__title">Pattern Matched</span>
                <span className="result__brand">
                  <BrandMark brand={result.brand} />
                  {result.brand.name}
                </span>
                <span className="result__meta">
                  Prefix {result.brand.prefixLabel} &middot; {result.length} digits &middot; Luhn
                  checksum {result.luhnValid ? 'passed' : 'failed'}
                </span>
                <span className="result__engine">
                  <Cpu size={12} strokeWidth={2.2} aria-hidden />
                  {result.engine} kernel &middot; {result.kernelMs.toFixed(3)} ms
                </span>
              </div>
            </div>
          ) : result ? (
            <div className="result result--bad">
              <span className="result__icon">
                <CircleX size={30} strokeWidth={2} aria-hidden />
              </span>
              <div className="result__body">
                <span className="result__title">No Matching Pattern Found</span>
                <span className="result__meta">
                  {result.nearMiss
                    ? `Prefix matches ${result.nearMiss.name}, but that network uses ${formatLengths(
                        result.nearMiss.lengths,
                      )} digits — this number has ${result.length}.`
                    : `No issuer pattern covers this prefix at ${result.length} digit${
                        result.length === 1 ? '' : 's'
                      }.`}
                </span>
                <span className="result__engine">
                  <Cpu size={12} strokeWidth={2.2} aria-hidden />
                  {result.engine} kernel &middot; {result.kernelMs.toFixed(3)} ms
                </span>
              </div>
            </div>
          ) : (
            <div className="result result--idle">
              <span className="result__icon">
                <Loader2 size={26} strokeWidth={1.75} className="spin" aria-hidden />
              </span>
              <div className="result__body">
                <span className="result__title">Matching on GPU…</span>
              </div>
            </div>
          )}
        </div>

        {brands.length > 0 && (
          <section className="supported">
            <span className="supported__title">
              {brands.length} networks in the CUDA table &mdash; tap to try
            </span>
            <div className="supported__list">
              {brands.map((brand) => (
                <button
                  key={brand.id}
                  type="button"
                  className="supported__item"
                  onClick={() => loadSample(brand.sample)}
                  title={`${brand.name} — starts with ${brand.prefixLabel}, ${formatLengths(
                    brand.lengths,
                  )} digits`}
                >
                  <BrandMark brand={brand} size="sm" title="" />
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="backend">
          {editingUrl ? (
            <form className="backend__form" onSubmit={saveUrl}>
              <input
                type="url"
                value={urlDraft}
                onChange={(event) => setUrlDraft(event.target.value)}
                placeholder="https://xxxx.trycloudflare.com"
                aria-label="CUDA backend URL"
              />
              <button type="submit" className="backend__save">
                Connect
              </button>
            </form>
          ) : (
            <div className="backend__status">
              <span className={`dot dot--${backend.state}`} aria-hidden />
              <span className="backend__text">
                {backend.state === 'online'
                  ? backend.device
                  : backend.state === 'connecting'
                    ? 'connecting…'
                    : 'no GPU backend'}
              </span>
              <button
                type="button"
                className="backend__edit"
                onClick={() => {
                  setUrlDraft(getApiUrl());
                  setEditingUrl(true);
                }}
              >
                change
              </button>
            </div>
          )}
        </section>
      </main>

      <p className="footnote">
        Matching runs in <code>cuda/card_matcher.cu</code> on an NVIDIA GPU. This page only formats
        the input and renders what the kernel returns. Max {MAX_DIGITS} digits.
      </p>
    </div>
  );
}
