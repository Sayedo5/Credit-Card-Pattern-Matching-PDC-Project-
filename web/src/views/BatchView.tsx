import { useState } from 'react';
import { Play, Loader2, Trash2, Plus } from 'lucide-react';
import {
  CARD_BRANDS,
  defaultRankCount,
  generateTestData,
  runGpu,
  runMpi,
  runSerial,
  summarize,
  type CardRecord,
  type EngineId,
  type EngineRun,
} from '../core';
import { useStore } from '../store';

const ENGINES: { id: EngineId; label: string; note: string }[] = [
  { id: 'serial', label: 'Serial CPU', note: 'One thread, the baseline' },
  { id: 'mpi', label: 'MPI Parallel', note: 'Master/worker across real threads' },
  { id: 'gpu', label: 'CUDA GPU', note: 'SIMT throughput model' },
];

/** Menu option 2 — Batch Mode (Multiple Cards). */
export function BatchView() {
  const { addRun } = useStore();
  const [source, setSource] = useState<'generate' | 'manual'>('generate');
  const [count, setCount] = useState(1000);
  const [invalidRate, setInvalidRate] = useState(10);
  const [engine, setEngine] = useState<EngineId>('serial');
  const [ranks, setRanks] = useState(defaultRankCount());
  const [manual, setManual] = useState<CardRecord[]>([
    { name: 'John Doe', number: '4578723572619063', cvv: '123', expiry: '12/30' },
  ]);
  const [run, setRun] = useState<EngineRun | null>(null);
  const [busy, setBusy] = useState(false);

  async function process() {
    setBusy(true);
    try {
      const cards =
        source === 'generate'
          ? generateTestData(count, { seed: 12345, invalidRate: invalidRate / 100 })
          : manual;

      if (cards.length === 0) return;

      let result: EngineRun;
      if (engine === 'serial') result = runSerial(cards);
      else if (engine === 'gpu') result = runGpu(cards);
      else result = await runMpi(cards, ranks);

      setRun(result);
      addRun(result);
    } finally {
      setBusy(false);
    }
  }

  const summary = run ? summarize(run.results) : null;

  return (
    <div className="view">
      <header className="view__header">
        <h2>Batch Mode</h2>
        <p>
          Validate many cards at once and pick which engine does the work. Every completed run is
          kept for the Export view.
        </p>
      </header>

      <div className="panel-card">
        <div className="seg">
          <button
            className={`seg__item ${source === 'generate' ? 'is-active' : ''}`}
            onClick={() => setSource('generate')}
          >
            Generate test data
          </button>
          <button
            className={`seg__item ${source === 'manual' ? 'is-active' : ''}`}
            onClick={() => setSource('manual')}
          >
            Enter cards manually
          </button>
        </div>

        {source === 'generate' ? (
          <div className="form__grid">
            <div className="form__row">
              <label className="field-label" htmlFor="b-count">
                How many cards
              </label>
              <div className="field">
                <input
                  id="b-count"
                  type="number"
                  min={1}
                  max={200000}
                  value={count}
                  onChange={(e) => setCount(Math.max(1, Math.min(200000, Number(e.target.value) || 1)))}
                />
              </div>
            </div>
            <div className="form__row">
              <label className="field-label" htmlFor="b-invalid">
                Deliberately invalid: {invalidRate}%
              </label>
              <input
                id="b-invalid"
                className="slider"
                type="range"
                min={0}
                max={50}
                value={invalidRate}
                onChange={(e) => setInvalidRate(Number(e.target.value))}
              />
            </div>
          </div>
        ) : (
          <ManualEditor cards={manual} onChange={setManual} />
        )}
      </div>

      <div className="panel-card">
        <span className="field-label">Processing method</span>
        <div className="engine-grid">
          {ENGINES.map((e) => (
            <button
              key={e.id}
              className={`engine ${engine === e.id ? 'is-active' : ''}`}
              onClick={() => setEngine(e.id)}
            >
              <span className="engine__label">{e.label}</span>
              <span className="engine__note">{e.note}</span>
            </button>
          ))}
        </div>

        {engine === 'mpi' && (
          <div className="form__row" style={{ marginTop: 14 }}>
            <label className="field-label" htmlFor="b-ranks">
              MPI ranks: {ranks} &nbsp;
              <span className="hint">{navigator.hardwareConcurrency || '?'} logical cores available</span>
            </label>
            <input
              id="b-ranks"
              className="slider"
              type="range"
              min={1}
              max={8}
              value={ranks}
              onChange={(e) => setRanks(Number(e.target.value))}
            />
          </div>
        )}

        <button className="button" onClick={process} disabled={busy}>
          {busy ? (
            <Loader2 size={18} strokeWidth={2} className="spin" aria-hidden />
          ) : (
            <Play size={18} strokeWidth={2} aria-hidden />
          )}
          Process batch
        </button>
      </div>

      {run && summary && (
        <div className="panel-card">
          <h3>Batch processing results</h3>
          <div className="stats">
            <Stat label="Method" value={run.label} />
            <Stat label="Total cards" value={summary.total.toLocaleString()} />
            <Stat label="Valid" value={summary.valid.toLocaleString()} tone="ok" />
            <Stat label="Invalid" value={summary.invalid.toLocaleString()} tone={summary.invalid ? 'bad' : undefined} />
            <Stat label="Success rate" value={`${summary.successRate.toFixed(1)}%`} />
            <Stat label="Time" value={`${run.time.toFixed(2)} ms`} />
          </div>

          {run.chunks && (
            <p className="footnote">
              Scattered as {run.chunks.join(' + ')} cards across {run.chunks.length} ranks, gathered
              back in rank order.
            </p>
          )}
          {run.model && (
            <p className="footnote">
              Modelled: {run.model.warps.toLocaleString()} blocks of {run.model.threads} threads.
              Real compute {run.model.measuredComputeMs.toFixed(2)} ms.
            </p>
          )}

          {summary.byType.length > 0 && (
            <>
              <h4>Card type distribution</h4>
              <div className="dist">
                {summary.byType.map((row) => {
                  const brand = CARD_BRANDS.find((b) => b.name === row.type);
                  const pct = (row.count / summary.valid) * 100;
                  return (
                    <div key={row.type} className="dist__row">
                      <span className="dist__name">{row.type}</span>
                      <span className="dist__bar">
                        <span
                          className="dist__fill"
                          style={{ width: `${pct}%`, background: brand?.color ?? 'var(--text-faint)' }}
                        />
                      </span>
                      <span className="dist__value">
                        {row.count.toLocaleString()} <span className="hint">{pct.toFixed(1)}%</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'bad' }) {
  return (
    <div className="stat">
      <span className="stat__label">{label}</span>
      <span className={`stat__value ${tone ? `is-${tone}` : ''}`}>{value}</span>
    </div>
  );
}

function ManualEditor({
  cards,
  onChange,
}: {
  cards: CardRecord[];
  onChange: (cards: CardRecord[]) => void;
}) {
  const update = (index: number, patch: Partial<CardRecord>) =>
    onChange(cards.map((c, i) => (i === index ? { ...c, ...patch } : c)));

  return (
    <div className="manual">
      {cards.map((card, index) => (
        <div key={index} className="manual__row">
          <input
            aria-label={`Name ${index + 1}`}
            placeholder="Name"
            value={card.name}
            onChange={(e) => update(index, { name: e.target.value })}
          />
          <input
            aria-label={`Card number ${index + 1}`}
            placeholder="Card number"
            inputMode="numeric"
            value={card.number}
            onChange={(e) => update(index, { number: e.target.value.replace(/\D/g, '') })}
          />
          <input
            aria-label={`CVV ${index + 1}`}
            placeholder="CVV"
            inputMode="numeric"
            value={card.cvv}
            onChange={(e) => update(index, { cvv: e.target.value.replace(/\D/g, '') })}
          />
          <input
            aria-label={`Expiry ${index + 1}`}
            placeholder="MM/YY"
            value={card.expiry}
            onChange={(e) => update(index, { expiry: e.target.value })}
          />
          <button
            className="icon-button"
            aria-label={`Remove card ${index + 1}`}
            onClick={() => onChange(cards.filter((_, i) => i !== index))}
            disabled={cards.length === 1}
          >
            <Trash2 size={15} strokeWidth={2} />
          </button>
        </div>
      ))}

      <button
        className="button button--ghost"
        onClick={() => onChange([...cards, { name: '', number: '', cvv: '', expiry: '' }])}
      >
        <Plus size={16} strokeWidth={2.2} aria-hidden />
        Add card
      </button>
    </div>
  );
}
