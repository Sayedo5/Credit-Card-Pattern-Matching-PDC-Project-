import { CARD_BRANDS, formatLengths } from '../core';

/**
 * The fan-out to the three engines and the merge back.
 *
 * A single vertical rule would pass straight through the middle engine and
 * read as "only MPI is connected", so the connector is drawn as a stem, a
 * horizontal bar spanning the outer two columns, and a leg down to each.
 * The bar and legs are hidden once the engines stack into one column.
 */
function Branch({ direction }: { direction: 'down' | 'up' }) {
  return (
    <div className={`arch__branch arch__branch--${direction}`} aria-hidden>
      <span className="arch__stem" />
      <span className="arch__bar" />
      {['16.667%', '50%', '83.333%'].map((left) => (
        <span key={left} className="arch__leg" style={{ left }} />
      ))}
    </div>
  );
}

/** Menu option 6 — System Architecture. */
export function ArchitectureView() {
  return (
    <div className="view">
      <header className="view__header">
        <h2>System Architecture</h2>
        <p>
          The same structure the notebook prints as an ASCII diagram: one input path, three
          interchangeable engines, one aggregator.
        </p>
      </header>

      <div className="panel-card">
        <div className="arch">
          <div className="arch__node arch__node--entry">
            <span className="arch__title">User Interface</span>
            <span className="arch__sub">Interactive &amp; batch input</span>
          </div>
          <div className="arch__arrow" aria-hidden />

          <div className="arch__node">
            <span className="arch__title">Batch Processor</span>
            <span className="arch__sub">Splits work, picks an engine</span>
          </div>
          <Branch direction="down" />

          <div className="arch__engines">
            <div className="arch__node arch__node--engine" style={{ borderColor: 'var(--series-1)' }}>
              <span className="arch__title">Serial CPU</span>
              <span className="arch__sub">One thread, baseline</span>
            </div>
            <div className="arch__node arch__node--engine" style={{ borderColor: 'var(--series-2)' }}>
              <span className="arch__title">MPI Distributed</span>
              <span className="arch__sub">Master/worker, real threads</span>
            </div>
            <div className="arch__node arch__node--engine" style={{ borderColor: 'var(--series-3)' }}>
              <span className="arch__title">CUDA GPU</span>
              <span className="arch__sub">SIMT throughput model</span>
            </div>
          </div>

          <Branch direction="up" />
          <div className="arch__node">
            <span className="arch__title">Result Aggregator</span>
            <span className="arch__sub">Gather, summarise, time</span>
          </div>
          <div className="arch__arrow" aria-hidden />

          <div className="arch__node arch__node--exit">
            <span className="arch__title">Output &amp; Export</span>
            <span className="arch__sub">JSON, Markdown report</span>
          </div>
        </div>
      </div>

      <div className="panel-card">
        <h3>Key components</h3>
        <ol className="numbered">
          <li>
            <strong>Master/worker distribution</strong>
            <span>
              The batch is split into one chunk per rank, scattered, and gathered back in rank
              order — <code>splitChunks</code> reproduces the notebook's{' '}
              <code>len(cards) // size</code> arithmetic, remainder to the last rank.
            </span>
          </li>
          <li>
            <strong>Parallel computation</strong>
            <span>
              Web Workers give each rank its own OS thread. The GPU path is an explicit model, not
              a device.
            </span>
          </li>
          <li>
            <strong>Load balancing</strong>
            <span>Equal chunks; the last rank absorbs the remainder.</span>
          </li>
          <li>
            <strong>Performance monitoring</strong>
            <span>
              Every engine is timed with <code>performance.now()</code> and compared against the
              serial baseline.
            </span>
          </li>
          <li>
            <strong>Data validation</strong>
            <span>Luhn checksum, CVV width, expiry window, and the prefix pattern table.</span>
          </li>
        </ol>
      </div>

      <div className="panel-card">
        <h3>Pattern table</h3>
        <p className="footnote">
          Evaluated top to bottom, first match wins. Order matters where ranges overlap: Discover's
          622126–622925 is the Discover-issued slice of UnionPay's 62, and Maestro's blanket 6 has
          to come last or it would swallow both.
        </p>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Network</th>
                <th>Starts with</th>
                <th>Length</th>
              </tr>
            </thead>
            <tbody>
              {CARD_BRANDS.map((brand, index) => (
                <tr key={brand.id}>
                  <td className="hint">{index + 1}</td>
                  <td>
                    <span className="swatch" style={{ background: brand.color }} aria-hidden />
                    {brand.name}
                  </td>
                  <td className="mono">{brand.prefixLabel}</td>
                  <td className="mono">{formatLengths(brand.lengths)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
