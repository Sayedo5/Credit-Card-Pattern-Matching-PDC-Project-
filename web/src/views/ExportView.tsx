import { Download, FileJson, FileText, Trash2 } from 'lucide-react';
import { CARD_BRANDS, formatLengths } from '../core';
import { useStore } from '../store';

/** Menu option 7 — Export Results. */
export function ExportView() {
  const { runs, clearRuns, perf } = useStore();

  const stamp = () => new Date().toISOString().replace(/[-:]/g, '').slice(0, 15).replace('T', '_');

  function download(filename: string, contents: string, type: string) {
    const blob = new Blob([contents], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  function exportResults() {
    const payload = {
      timestamp: new Date().toISOString(),
      runs: runs.map((run) => ({
        processing_method: run.label,
        timestamp: run.timestamp,
        total_cards: run.total,
        valid_cards: run.valid,
        time_ms: Number(run.timeMs.toFixed(3)),
        results_sample: run.results,
      })),
    };
    download(`credit_card_results_${stamp()}.json`, JSON.stringify(payload, null, 2), 'application/json');
  }

  function exportSampleData() {
    const payload = CARD_BRANDS.map((brand) => ({
      network: brand.name,
      starts_with: brand.prefixLabel,
      length: formatLengths(brand.lengths),
      sample_number: brand.sample,
    }));
    download(`sample_data_${stamp()}.json`, JSON.stringify(payload, null, 2), 'application/json');
  }

  function exportReport() {
    const lines = [
      '# Credit Card Pattern Detection — Project Report',
      '',
      `**Generated:** ${new Date().toLocaleString()}`,
      `**Runtime:** browser, ${navigator.hardwareConcurrency || '?'} logical cores`,
      '',
      '## System overview',
      '',
      'Credit card validation and issuer-network detection, with three interchangeable',
      'processing engines: serial, MPI-style master/worker across Web Workers, and a',
      'CUDA SIMT throughput model.',
      '',
      '## Features implemented',
      '',
      '1. Credit card validation (Luhn algorithm)',
      '2. CVV validation (3 digits, 4 for American Express)',
      '3. Expiry date validation (MM/YY, must not be past)',
      '4. Card type detection across 8 networks',
      '5. MPI-style distributed processing',
      '6. CUDA GPU throughput model',
      '7. Performance analysis',
      '8. Batch processing',
      '',
      '## Pattern table',
      '',
      '| # | Network | Starts with | Length |',
      '|---|---------|-------------|--------|',
      ...CARD_BRANDS.map(
        (b, i) => `| ${i + 1} | ${b.name} | ${b.prefixLabel} | ${formatLengths(b.lengths)} |`,
      ),
      '',
    ];

    if (perf.length > 0) {
      lines.push(
        '## Performance results',
        '',
        '| Cards | Serial (ms) | MPI (ms) | GPU (ms) | MPI speedup | GPU speedup |',
        '|-------|-------------|----------|----------|-------------|-------------|',
        ...perf.map(
          (r) =>
            `| ${r.size.toLocaleString()} | ${r.serial.toFixed(2)} | ${r.mpi.toFixed(2)} | ` +
            `${r.gpu.toFixed(3)} | ${(r.serial / r.mpi).toFixed(2)}x | ${(r.serial / r.gpu).toFixed(1)}x |`,
        ),
        '',
      );
    } else {
      lines.push('## Performance results', '', '_Run the Performance Analysis view first._', '');
    }

    if (runs.length > 0) {
      lines.push(
        '## Batch runs',
        '',
        '| Method | Cards | Valid | Time (ms) |',
        '|--------|-------|-------|-----------|',
        ...runs.map(
          (r) =>
            `| ${r.label} | ${r.total.toLocaleString()} | ${r.valid.toLocaleString()} | ${r.timeMs.toFixed(2)} |`,
        ),
        '',
      );
    }

    lines.push(
      '## Notes',
      '',
      '- GPU timings are modelled, not measured on hardware.',
      '- MPI timings are real: each rank is a Web Worker on its own OS thread.',
      '',
    );

    download(`project_report_${stamp()}.md`, lines.join('\n'), 'text/markdown');
  }

  return (
    <div className="view">
      <header className="view__header">
        <h2>Export Results</h2>
        <p>
          Writes the same three artefacts the notebook's export step produces — a results JSON, a
          sample-data JSON, and a Markdown report — as browser downloads.
        </p>
      </header>

      <div className="panel-card">
        <h3>Downloads</h3>
        <div className="export-grid">
          <button className="export" onClick={exportResults} disabled={runs.length === 0}>
            <FileJson size={20} strokeWidth={1.8} aria-hidden />
            <span className="export__name">credit_card_results.json</span>
            <span className="export__note">
              {runs.length === 0 ? 'Run a batch first' : `${runs.length} run${runs.length === 1 ? '' : 's'} recorded`}
            </span>
          </button>

          <button className="export" onClick={exportSampleData}>
            <FileJson size={20} strokeWidth={1.8} aria-hidden />
            <span className="export__name">sample_data.json</span>
            <span className="export__note">One valid number per network</span>
          </button>

          <button className="export" onClick={exportReport}>
            <FileText size={20} strokeWidth={1.8} aria-hidden />
            <span className="export__name">project_report.md</span>
            <span className="export__note">
              {perf.length > 0 ? 'Includes performance table' : 'Run Performance Analysis for timings'}
            </span>
          </button>
        </div>
      </div>

      <div className="panel-card">
        <div className="row-between">
          <h3>Recorded runs</h3>
          {runs.length > 0 && (
            <button className="button button--ghost button--sm" onClick={clearRuns}>
              <Trash2 size={15} strokeWidth={2} aria-hidden />
              Clear
            </button>
          )}
        </div>

        {runs.length === 0 ? (
          <p className="footnote">
            Nothing yet. Process a batch in Batch Mode and it will appear here.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Method</th>
                  <th>Cards</th>
                  <th>Valid</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td className="hint">{new Date(run.timestamp).toLocaleTimeString()}</td>
                    <td>{run.label}</td>
                    <td>{run.total.toLocaleString()}</td>
                    <td>{run.valid.toLocaleString()}</td>
                    <td>{run.timeMs.toFixed(2)} ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="footnote">
        <Download size={13} strokeWidth={2} aria-hidden style={{ verticalAlign: '-2px' }} /> Files
        are generated in the browser and saved straight to your downloads folder. No card data is
        transmitted anywhere.
      </p>
    </div>
  );
}
