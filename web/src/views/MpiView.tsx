import { useState } from 'react';
import { Loader2, Zap } from 'lucide-react';
import {
  defaultRankCount,
  generateTestData,
  measureMedian,
  runMpi,
  runSerial,
  splitChunks,
  MAX_RANKS,
} from '../core';

type Row = {
  size: number;
  serialMs: number;
  mpiMs: number;
  speedup: number;
  chunks: number[];
  valid: number;
};

const SIZES = [100, 1000, 5000, 10000];

/** Menu option 3 — MPI Parallel Processing Demo. */
export function MpiView() {
  const [ranks, setRanks] = useState(defaultRankCount());
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');

  async function runDemo() {
    setBusy(true);
    setRows([]);
    try {
      const collected: Row[] = [];
      for (const size of SIZES) {
        setProgress(`${size.toLocaleString()} cards…`);
        const cards = generateTestData(size, { seed: 12345, invalidRate: 0.1 });

        const serial = await measureMedian(() => runSerial(cards));
        const mpi = await measureMedian(() => runMpi(cards, ranks));

        collected.push({
          size,
          serialMs: serial.time,
          mpiMs: mpi.time,
          speedup: serial.time / mpi.time,
          chunks: mpi.chunks ?? [],
          valid: mpi.results.filter((r) => r.valid).length,
        });
        setRows([...collected]);
        // Let the browser paint between sizes.
        await new Promise((r) => setTimeout(r, 0));
      }
    } finally {
      setBusy(false);
      setProgress('');
    }
  }

  return (
    <div className="view">
      <header className="view__header">
        <h2>MPI Parallel Processing Demo</h2>
        <p>
          The master splits the batch, scatters one chunk to each rank, and gathers the results back
          in rank order — the choreography of{' '}
          <code>validate_batch_mpi</code>, with Web Workers as the ranks.
        </p>
      </header>

      <div className="panel-card">
        <div className="form__row">
          <label className="field-label" htmlFor="mpi-ranks">
            MPI ranks: {ranks}{' '}
            <span className="hint">
              {navigator.hardwareConcurrency || '?'} logical cores on this machine
            </span>
          </label>
          <input
            id="mpi-ranks"
            className="slider"
            type="range"
            min={1}
            max={MAX_RANKS}
            value={ranks}
            onChange={(e) => setRanks(Number(e.target.value))}
            disabled={busy}
          />
        </div>

        <p className="footnote">
          1,000 cards over {ranks} ranks ={' '}
          {splitChunks(Array.from({ length: 1000 }), ranks)
            .map((c) => c.length)
            .join(' + ')}
          . The last rank absorbs the remainder, exactly as the notebook chunks it.
        </p>

        <button className="button" onClick={runDemo} disabled={busy}>
          {busy ? (
            <Loader2 size={18} strokeWidth={2} className="spin" aria-hidden />
          ) : (
            <Zap size={18} strokeWidth={2} aria-hidden />
          )}
          {busy ? progress || 'Running…' : 'Run MPI demo'}
        </button>
      </div>

      {rows.length > 0 && (
        <div className="panel-card">
          <h3>Results</h3>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Cards</th>
                  <th>Serial</th>
                  <th>MPI ({ranks})</th>
                  <th>Speedup</th>
                  <th>Valid</th>
                  <th>Chunks</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.size}>
                    <td>{row.size.toLocaleString()}</td>
                    <td>{row.serialMs.toFixed(2)} ms</td>
                    <td>{row.mpiMs.toFixed(2)} ms</td>
                    <td className={row.speedup >= 1 ? 'is-ok' : 'is-bad'}>
                      {row.speedup.toFixed(2)}×
                    </td>
                    <td>
                      {row.valid.toLocaleString()}/{row.size.toLocaleString()}
                    </td>
                    <td className="hint">{row.chunks.join(' + ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="footnote">
            Expect a speedup below 1× on the small batches. Scattering the cards means structured-
            cloning them across thread boundaries, and at 100 cards that messaging costs more than
            the validation it saves — the same reason the notebook's own run reported MPI at 0.75×
            the serial speed on 1,000 cards.
          </p>
        </div>
      )}
    </div>
  );
}
