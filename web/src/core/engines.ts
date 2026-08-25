/*
 * The three processing engines from the notebook's main menu.
 *
 *   run_serial_validation   -> runSerial   (one thread, the baseline)
 *   validate_batch_mpi      -> runMpi      (master/worker across real threads)
 *   validate_batch_gpu      -> runGpu      (SIMT throughput model)
 *
 * runSerial and runMpi are genuinely parallel-vs-serial: the MPI path splits
 * the batch across Web Workers, each on its own OS thread, and gathers the
 * results back — the same master/worker choreography as mpi4py's
 * send/recv/gather, with structured-clone messaging standing in for MPI's.
 *
 * runGpu is a *model*, and says so everywhere it surfaces. See the note on
 * GPU_CORES below.
 */

import {
  detectCardType,
  matchBrand,
  validateCardNumber,
  validateCvv,
  validateExpiry,
} from './validation';
import type { BatchResult, CardRecord, EngineRun, GpuModel } from './types';
import type { WorkerRequest, WorkerResponse } from '../workers/validator.worker';

/* ------------------------------------------------------------------ */
/* Serial — the baseline                                               */
/* ------------------------------------------------------------------ */

function validateOne(card: CardRecord): BatchResult {
  const numberResult = validateCardNumber(card.number);
  const { brand } = matchBrand(card.number);
  const cvvResult = validateCvv(card.cvv, brand);
  const expiryResult = validateExpiry(card.expiry);

  if (numberResult.ok && cvvResult.ok && expiryResult.ok && numberResult.cleaned) {
    return { card: card.number, valid: true, type: detectCardType(numberResult.cleaned) };
  }
  return { card: card.number, valid: false, type: 'Invalid' };
}

export function runSerial(cards: CardRecord[]): EngineRun {
  const start = performance.now();
  const results = cards.map(validateOne);
  const time = performance.now() - start;

  return { engine: 'serial', label: 'Serial CPU', results, time };
}

/* ------------------------------------------------------------------ */
/* MPI — master/worker across real threads                             */
/* ------------------------------------------------------------------ */

export const MAX_RANKS = 8;

/** How many ranks this machine can actually run in parallel. */
export function defaultRankCount(): number {
  const cores = navigator.hardwareConcurrency || 4;
  return Math.max(2, Math.min(MAX_RANKS, cores));
}

/**
 * A persistent pool, created once and reused. MPI ranks are already running
 * when you call `validate_batch_mpi`, so charging worker startup to every
 * batch would misreport the comparison.
 */
class WorkerPool {
  private workers: Worker[] = [];
  private nextId = 0;

  size(): number {
    return this.workers.length;
  }

  resize(count: number): void {
    while (this.workers.length > count) this.workers.pop()?.terminate();
    while (this.workers.length < count) {
      this.workers.push(
        new Worker(new URL('../workers/validator.worker.ts', import.meta.url), {
          type: 'module',
        }),
      );
    }
  }

  /** Warm every rank so the first timed run is not paying for module init. */
  async warmUp(): Promise<void> {
    const probe: CardRecord[] = [
      { name: 'warm', number: '4111111111111111', cvv: '123', expiry: '12/30' },
    ];
    await Promise.all(this.workers.map((_, rank) => this.dispatch(rank, probe)));
  }

  dispatch(rank: number, cards: CardRecord[]): Promise<BatchResult[]> {
    const worker = this.workers[rank];
    const id = this.nextId++;

    return new Promise((resolve) => {
      const onMessage = (event: MessageEvent<WorkerResponse>) => {
        if (event.data.id !== id) return;
        worker.removeEventListener('message', onMessage);
        resolve(event.data.results);
      };
      worker.addEventListener('message', onMessage);

      const request: WorkerRequest = { id, rank, cards };
      worker.postMessage(request);
    });
  }

  terminate(): void {
    this.workers.forEach((w) => w.terminate());
    this.workers = [];
  }
}

const pool = new WorkerPool();

export async function ensurePool(rankCount: number): Promise<void> {
  if (pool.size() !== rankCount) {
    pool.resize(rankCount);
    await pool.warmUp();
  }
}

export function shutdownPool(): void {
  pool.terminate();
}

/**
 * The notebook's chunking, exactly: `chunk_size = len(cards) // size`, and the
 * last rank absorbs the remainder.
 */
export function splitChunks<T>(items: T[], size: number): T[][] {
  const chunkSize = Math.floor(items.length / size);
  const chunks: T[][] = [];

  for (let i = 0; i < size; i++) {
    const start = i * chunkSize;
    const end = i < size - 1 ? start + chunkSize : items.length;
    chunks.push(items.slice(start, end));
  }
  return chunks;
}

export async function runMpi(cards: CardRecord[], rankCount: number): Promise<EngineRun> {
  await ensurePool(rankCount);

  const chunks = splitChunks(cards, rankCount);
  const start = performance.now();

  // Scatter to every rank, then gather in rank order.
  const gathered = await Promise.all(chunks.map((chunk, rank) => pool.dispatch(rank, chunk)));
  const results = gathered.flat();

  const time = performance.now() - start;

  return {
    engine: 'mpi',
    label: `MPI (${rankCount} ranks)`,
    results,
    time,
    chunks: chunks.map((c) => c.length),
  };
}

/* ------------------------------------------------------------------ */
/* GPU — an explicit throughput model, not a real device               */
/* ------------------------------------------------------------------ */

/**
 * CUDA core count of a Tesla T4, the GPU this project targets in Colab.
 *
 * The notebook models the GPU with `time.sleep(0.00001)` per card, which is a
 * per-card *serial delay* — it makes the "GPU" the slowest engine in its own
 * results table (0.1x speedup). This models SIMT instead: the device runs
 * GPU_CORES cards concurrently, so it needs ceil(n / GPU_CORES) rounds, each
 * costing one card's real measured work, plus a fixed launch overhead.
 *
 * The reported time is derived, not measured. The results themselves are real
 * — every card is genuinely validated.
 */
export const GPU_CORES = 2560;
export const GPU_LAUNCH_OVERHEAD_MS = 0.05;
export const GPU_THREADS_PER_BLOCK = 256;
/** Bytes moved per card across PCIe: 19 digits in, two ints back. */
export const GPU_BYTES_PER_CARD = 27;
/** Effective host-to-device bandwidth, bytes per millisecond (~8 GB/s). */
export const GPU_BANDWIDTH_B_PER_MS = 8_000_000;

export function runGpu(cards: CardRecord[]): EngineRun {
  const start = performance.now();
  const results = cards.map(validateOne);
  const measuredComputeMs = performance.now() - start;

  const n = cards.length || 1;
  const perCardMs = measuredComputeMs / n;
  const rounds = Math.ceil(n / GPU_CORES);

  // Compute alone would make the curve flat below GPU_CORES and imply
  // speedups that no real device reaches. The PCIe copy is what actually
  // dominates a kernel this cheap, so the model has to carry it.
  const transferMs = (n * GPU_BYTES_PER_CARD) / GPU_BANDWIDTH_B_PER_MS;
  const time = GPU_LAUNCH_OVERHEAD_MS + transferMs + rounds * perCardMs;

  const model: GpuModel = {
    threads: GPU_THREADS_PER_BLOCK,
    warps: Math.ceil(n / GPU_THREADS_PER_BLOCK),
    launchOverheadMs: GPU_LAUNCH_OVERHEAD_MS,
    measuredComputeMs,
  };

  return { engine: 'gpu', label: 'CUDA GPU (modelled)', results, time, model };
}

/* ------------------------------------------------------------------ */
/* Timing                                                              */
/* ------------------------------------------------------------------ */

/**
 * Run an engine several times and keep the median time.
 *
 * A single sample on a browser main thread is badly behaved — one GC pause or
 * scheduler hiccup during the 1,000-card run is enough to put a spike in the
 * chart that reads as a real property of the algorithm. The median of a few
 * runs is stable without hiding the genuine shape.
 */
export async function measureMedian(
  run: () => EngineRun | Promise<EngineRun>,
  repeats = 3,
): Promise<EngineRun> {
  const samples: EngineRun[] = [];
  for (let i = 0; i < repeats; i++) samples.push(await run());

  const times = samples.map((s) => s.time).sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];

  return { ...samples[samples.length - 1], time: median };
}

/* ------------------------------------------------------------------ */
/* Summaries                                                           */
/* ------------------------------------------------------------------ */

export type RunSummary = {
  total: number;
  valid: number;
  invalid: number;
  successRate: number;
  byType: { type: string; count: number }[];
};

/** Mirrors `display_batch_results`. */
export function summarize(results: BatchResult[]): RunSummary {
  const valid = results.filter((r) => r.valid).length;
  const counts = new Map<string, number>();

  for (const r of results) {
    if (!r.valid) continue;
    counts.set(r.type, (counts.get(r.type) ?? 0) + 1);
  }

  return {
    total: results.length,
    valid,
    invalid: results.length - valid,
    successRate: results.length ? (valid / results.length) * 100 : 0,
    byType: [...counts.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count),
  };
}
