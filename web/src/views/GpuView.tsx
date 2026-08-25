import { useState } from 'react';
import { AlertTriangle, Cpu, Loader2 } from 'lucide-react';
import {
  CUDA_KERNEL_SOURCE,
  GPU_BYTES_PER_CARD,
  GPU_CORES,
  GPU_LAUNCH_OVERHEAD_MS,
  GPU_THREADS_PER_BLOCK,
  KERNEL_NOTES,
  generateTestData,
  measureMedian,
  runGpu,
  runSerial,
} from '../core';

type Row = {
  size: number;
  serialMs: number;
  gpuMs: number;
  speedup: number;
  blocks: number;
  valid: number;
};

const SIZES = [100, 1000, 10000, 100000];

/** Menu option 4 — CUDA GPU Simulation. */
export function GpuView() {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);

  async function runDemo() {
    setBusy(true);
    setRows([]);
    try {
      const collected: Row[] = [];
      for (const size of SIZES) {
        const cards = generateTestData(size, { seed: 12345, invalidRate: 0.1 });
        const serial = await measureMedian(() => runSerial(cards));
        const gpu = await measureMedian(() => runGpu(cards));

        collected.push({
          size,
          serialMs: serial.time,
          gpuMs: gpu.time,
          speedup: serial.time / gpu.time,
          blocks: gpu.model?.warps ?? 0,
          valid: gpu.results.filter((r) => r.valid).length,
        });
        setRows([...collected]);
        await new Promise((r) => setTimeout(r, 0));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="view">
      <header className="view__header">
        <h2>CUDA GPU Simulation</h2>
        <p>
          The kernel the notebook generates, and a throughput model standing in for the device this
          browser does not have.
        </p>
      </header>

      <div className="callout callout--warn">
        <AlertTriangle size={18} strokeWidth={2} aria-hidden />
        <div>
          <strong>This is a model, not a GPU.</strong> Card results are computed for real, but the
          reported time is <em>derived</em>:{' '}
          <code>
            t = {GPU_LAUNCH_OVERHEAD_MS} ms + (n × {GPU_BYTES_PER_CARD} B ÷ 8 GB/s) + ⌈n /{' '}
            {GPU_CORES.toLocaleString()}⌉ × per-card cost
          </code>
          , where {GPU_CORES.toLocaleString()} is the CUDA core count of a Tesla T4. The middle term
          is the PCIe copy — for a kernel this cheap it is what actually dominates, and leaving it
          out would give a flat line and speedups no real device reaches. Nothing here touches real
          hardware.
        </div>
      </div>

      <div className="panel-card">
        <button className="button" onClick={runDemo} disabled={busy}>
          {busy ? (
            <Loader2 size={18} strokeWidth={2} className="spin" aria-hidden />
          ) : (
            <Cpu size={18} strokeWidth={2} aria-hidden />
          )}
          Run GPU simulation
        </button>

        {rows.length > 0 && (
          <div className="table-wrap" style={{ marginTop: 18 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Cards</th>
                  <th>Serial CPU</th>
                  <th>GPU (modelled)</th>
                  <th>Speedup</th>
                  <th>Blocks × {GPU_THREADS_PER_BLOCK}</th>
                  <th>Valid</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.size}>
                    <td>{row.size.toLocaleString()}</td>
                    <td>{row.serialMs.toFixed(2)} ms</td>
                    <td>{row.gpuMs.toFixed(3)} ms</td>
                    <td className={row.speedup >= 1 ? 'is-ok' : 'is-bad'}>
                      {row.speedup.toFixed(1)}×
                    </td>
                    <td className="hint">{row.blocks.toLocaleString()}</td>
                    <td>
                      {row.valid.toLocaleString()}/{row.size.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel-card">
        <h3>Generated CUDA kernel</h3>
        <p className="footnote">
          Reproduced verbatim from <code>generate_cuda_kernel_code()</code> in the notebook.
        </p>
        <pre className="code">
          <code>{CUDA_KERNEL_SOURCE}</code>
        </pre>
      </div>

      <div className="panel-card">
        <h3>Defects in that kernel</h3>
        <p className="footnote">
          Worth knowing before quoting it in a report — the integer representation it chose cannot
          hold the numbers it is given.
        </p>
        <ul className="notes">
          {KERNEL_NOTES.map((note) => (
            <li key={note.title}>
              <strong>{note.title}</strong>
              <span>{note.detail}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
