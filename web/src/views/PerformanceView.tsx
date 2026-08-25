import { useState } from 'react';
import { BarChart3, Loader2 } from 'lucide-react';
import {
  defaultRankCount,
  generateTestData,
  measureMedian,
  runGpu,
  runMpi,
  runSerial,
  MAX_RANKS,
} from '../core';
import { LineChart, type ChartSeries } from '../components/LineChart';
import { useStore } from '../store';

const SIZES = [100, 500, 1000, 5000, 10000, 50000];

/** Menu option 5 — Performance Analysis. */
export function PerformanceView() {
  const { perf, setPerf } = useStore();
  const [ranks, setRanks] = useState(defaultRankCount());
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');

  async function analyse() {
    setBusy(true);
    setPerf([]);
    try {
      const rows: typeof perf = [];
      for (const size of SIZES) {
        setProgress(`${size.toLocaleString()} cards…`);
        const cards = generateTestData(size, { seed: 12345, invalidRate: 0.1 });

        // Median of three: one GC pause otherwise shows up as an algorithmic spike.
        const serial = await measureMedian(() => runSerial(cards));
        const mpi = await measureMedian(() => runMpi(cards, ranks));
        const gpu = await measureMedian(() => runGpu(cards));

        rows.push({ size, serial: serial.time, mpi: mpi.time, gpu: gpu.time });
        setPerf([...rows]);
        await new Promise((r) => setTimeout(r, 0));
      }
    } finally {
      setBusy(false);
      setProgress('');
    }
  }

  const series: ChartSeries[] = [
    { id: 'serial', label: 'Serial CPU', colorVar: '--series-1', points: perf.map((r) => ({ x: r.size, y: r.serial })) },
    { id: 'mpi', label: `MPI (${ranks})`, colorVar: '--series-2', points: perf.map((r) => ({ x: r.size, y: r.mpi })) },
    { id: 'gpu', label: 'GPU (model)', colorVar: '--series-3', points: perf.map((r) => ({ x: r.size, y: r.gpu })) },
  ];

  return (
    <div className="view">
      <header className="view__header">
        <h2>Performance Analysis</h2>
        <p>
          All three engines over the same batches, from 100 to 50,000 cards. Both axes are
          logarithmic, so a straight line means constant cost per card.
        </p>
      </header>

      <div className="panel-card">
        <div className="form__row">
          <label className="field-label" htmlFor="perf-ranks">
            MPI ranks: {ranks}
          </label>
          <input
            id="perf-ranks"
            className="slider"
            type="range"
            min={1}
            max={MAX_RANKS}
            value={ranks}
            onChange={(e) => setRanks(Number(e.target.value))}
            disabled={busy}
          />
        </div>

        <button className="button" onClick={analyse} disabled={busy}>
          {busy ? (
            <Loader2 size={18} strokeWidth={2} className="spin" aria-hidden />
          ) : (
            <BarChart3 size={18} strokeWidth={2} aria-hidden />
          )}
          {busy ? progress || 'Running…' : 'Run performance analysis'}
        </button>
      </div>

      {perf.length > 1 && (
        <>
          <div className="panel-card">
            <h3>Processing time</h3>
            <LineChart
              series={series}
              xLabel="Number of credit cards"
              yLabel="Time (ms)"
              formatY={(v) => (v >= 10 ? v.toFixed(0) : v >= 1 ? v.toFixed(1) : v.toFixed(2))}
              formatX={(v) => (v >= 1000 ? `${v / 1000}k` : String(v))}
            />
          </div>

          <div className="panel-card">
            <h3>Comparison table</h3>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Cards</th>
                    <th>Serial (ms)</th>
                    <th>MPI (ms)</th>
                    <th>GPU (ms)</th>
                    <th>MPI speedup</th>
                    <th>GPU speedup</th>
                  </tr>
                </thead>
                <tbody>
                  {perf.map((row) => {
                    const mpiSpeedup = row.serial / row.mpi;
                    const gpuSpeedup = row.serial / row.gpu;
                    return (
                      <tr key={row.size}>
                        <td>{row.size.toLocaleString()}</td>
                        <td>{row.serial.toFixed(2)}</td>
                        <td>{row.mpi.toFixed(2)}</td>
                        <td>{row.gpu.toFixed(3)}</td>
                        <td className={mpiSpeedup >= 1 ? 'is-ok' : 'is-bad'}>
                          {mpiSpeedup.toFixed(2)}×
                        </td>
                        <td className={gpuSpeedup >= 1 ? 'is-ok' : 'is-bad'}>
                          {gpuSpeedup.toFixed(1)}×
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <p className="footnote">
              The crossover is the interesting part: MPI loses on small batches because scattering
              costs more than it saves, and wins once each rank has enough work to amortise the
              messaging. GPU figures come from the throughput model described in the CUDA view, not
              from hardware.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
