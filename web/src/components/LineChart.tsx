import { useId, useMemo, useRef, useState } from 'react';

/*
 * Log-log line chart for the performance views.
 *
 * Series colours are the first three slots of the validated categorical
 * palette, defined as CSS custom properties in index.css so the dark steps
 * swap in one place. Every series carries a legend entry *and* a direct end
 * label — which is also the relief the light-mode aqua needs to clear the
 * contrast check.
 *
 * The hover readout sits in a fixed strip above the plot rather than floating
 * over it: a tooltip anchored inside the frame covers the end labels of
 * whichever series finish highest, which is exactly where the eye goes.
 */

export type ChartSeries = {
  id: string;
  label: string;
  /** CSS custom property name, e.g. "--series-1". */
  colorVar: string;
  points: { x: number; y: number }[];
};

type Props = {
  series: ChartSeries[];
  xLabel: string;
  yLabel: string;
  formatY?: (value: number) => string;
  formatX?: (value: number) => string;
  height?: number;
};

const PAD = { top: 14, right: 104, bottom: 46, left: 62 };

export function LineChart({
  series,
  xLabel,
  yLabel,
  formatY = (v) => v.toFixed(2),
  formatX = (v) => v.toLocaleString(),
  height = 300,
}: Props) {
  const titleId = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const width = 720;
  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;

  const { xs, xScale, yScale, yTicks } = useMemo(() => {
    const allX = series.flatMap((s) => s.points.map((p) => p.x));
    const allY = series.flatMap((s) => s.points.map((p) => p.y)).filter((v) => v > 0);

    const lg = (v: number) => Math.log10(Math.max(v, 1e-9));

    const xMin = Math.min(...allX);
    const xMax = Math.max(...allX);
    const xSpan = lg(xMax) - lg(xMin) || 1;

    // Pad the y range so the top and bottom series are not glued to the frame.
    const yLo = lg(Math.min(...allY)) - 0.15;
    const yHi = lg(Math.max(...allY)) + 0.15;
    const ySpan = yHi - yLo || 1;

    // Decade ticks, but only those that actually fall inside the padded range —
    // otherwise a tick renders outside the plot and collides with the axis label.
    const ticks: number[] = [];
    for (let e = Math.floor(yLo); e <= Math.ceil(yHi); e++) {
      if (e >= yLo && e <= yHi) ticks.push(10 ** e);
    }

    return {
      xs: [...new Set(allX)].sort((a, b) => a - b),
      xScale: (v: number) => PAD.left + ((lg(v) - lg(xMin)) / xSpan) * plotW,
      yScale: (v: number) => PAD.top + plotH - ((lg(v) - yLo) / ySpan) * plotH,
      yTicks: ticks,
    };
  }, [series, plotW, plotH]);

  function handleMove(event: React.PointerEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * width;

    let best = 0;
    let bestDistance = Infinity;
    xs.forEach((value, index) => {
      const distance = Math.abs(xScale(value) - x);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    });
    setHoverIndex(best);
  }

  // Default the readout to the largest batch so the strip is never empty and
  // the layout never shifts when the pointer arrives.
  const readoutX = hoverIndex === null ? xs[xs.length - 1] : xs[hoverIndex];

  return (
    <div className="chart">
      <div className="chart__readout">
        <span className="chart__readout-head">
          {formatX(readoutX)} cards
          {hoverIndex === null && <span className="hint"> — hover the chart</span>}
        </span>
        <div className="chart__readout-values">
          {series.map((s) => {
            const point = s.points.find((p) => p.x === readoutX);
            if (!point) return null;
            return (
              <span key={s.id} className="chart__readout-row">
                <span className="chart__swatch" style={{ background: `var(${s.colorVar})` }} />
                {s.label}
                <b>{formatY(point.y)} ms</b>
              </span>
            );
          })}
        </div>
      </div>

      <svg
        ref={svgRef}
        className="chart__svg"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-labelledby={titleId}
        onPointerMove={handleMove}
        onPointerLeave={() => setHoverIndex(null)}
      >
        <title id={titleId}>
          {yLabel} against {xLabel} for {series.map((s) => s.label).join(', ')}
        </title>

        {yTicks.map((tick) => (
          <g key={`y${tick}`}>
            <line
              className="chart__grid"
              x1={PAD.left}
              x2={PAD.left + plotW}
              y1={yScale(tick)}
              y2={yScale(tick)}
            />
            <text
              className="chart__tick"
              x={PAD.left - 10}
              y={yScale(tick)}
              textAnchor="end"
              dy="0.32em"
            >
              {formatY(tick)}
            </text>
          </g>
        ))}

        {xs.map((tick) => (
          <text
            key={`x${tick}`}
            className="chart__tick"
            x={xScale(tick)}
            y={PAD.top + plotH + 19}
            textAnchor="middle"
          >
            {formatX(tick)}
          </text>
        ))}

        <line
          className="chart__axis"
          x1={PAD.left}
          x2={PAD.left + plotW}
          y1={PAD.top + plotH}
          y2={PAD.top + plotH}
        />

        <text
          className="chart__axis-label"
          x={PAD.left + plotW / 2}
          y={height - 8}
          textAnchor="middle"
        >
          {xLabel}
        </text>
        <text
          className="chart__axis-label"
          transform={`translate(14 ${PAD.top + plotH / 2}) rotate(-90)`}
          textAnchor="middle"
        >
          {yLabel}
        </text>

        {hoverIndex !== null && (
          <line
            className="chart__crosshair"
            x1={xScale(readoutX)}
            x2={xScale(readoutX)}
            y1={PAD.top}
            y2={PAD.top + plotH}
          />
        )}

        {series.map((s) => {
          const d = s.points
            .map(
              (p, i) => `${i === 0 ? 'M' : 'L'}${xScale(p.x).toFixed(1)} ${yScale(p.y).toFixed(1)}`,
            )
            .join(' ');
          const last = s.points[s.points.length - 1];

          return (
            <g key={s.id} style={{ color: `var(${s.colorVar})` }}>
              <path className="chart__line" d={d} />
              {s.points.map((p) => (
                <circle
                  key={p.x}
                  className="chart__dot"
                  cx={xScale(p.x)}
                  cy={yScale(p.y)}
                  r={hoverIndex !== null && readoutX === p.x ? 6 : 4.5}
                />
              ))}
              {/* direct label — identity is never colour-alone */}
              <text
                className="chart__series-label"
                x={xScale(last.x) + 11}
                y={yScale(last.y)}
                dy="0.32em"
              >
                {s.label}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="chart__legend">
        {series.map((s) => (
          <span key={s.id} className="chart__legend-item">
            <span className="chart__swatch" style={{ background: `var(${s.colorVar})` }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}
