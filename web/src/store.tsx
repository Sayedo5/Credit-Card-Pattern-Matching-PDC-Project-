import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { EngineRun } from './core';

/**
 * Completed runs, kept so the Export view has something to write out — the
 * same role `save_results_to_file` plays in the notebook, minus the disk.
 */

export type StoredRun = {
  id: string;
  timestamp: string;
  engine: EngineRun['engine'];
  label: string;
  total: number;
  valid: number;
  timeMs: number;
  results: EngineRun['results'];
};

export type PerfRow = {
  size: number;
  serial: number;
  mpi: number;
  gpu: number;
};

type Store = {
  runs: StoredRun[];
  addRun: (run: EngineRun) => void;
  clearRuns: () => void;
  perf: PerfRow[];
  setPerf: (rows: PerfRow[]) => void;
};

const StoreContext = createContext<Store | null>(null);

let counter = 0;

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [runs, setRuns] = useState<StoredRun[]>([]);
  const [perf, setPerf] = useState<PerfRow[]>([]);

  const addRun = useCallback((run: EngineRun) => {
    const stored: StoredRun = {
      id: `run-${++counter}`,
      timestamp: new Date().toISOString(),
      engine: run.engine,
      label: run.label,
      total: run.results.length,
      valid: run.results.filter((r) => r.valid).length,
      timeMs: run.time,
      // Cap what we retain: a 200k-card run does not need to live in memory
      // twice, and the export only ever shows a sample.
      results: run.results.slice(0, 500),
    };
    setRuns((prev) => [stored, ...prev].slice(0, 20));
  }, []);

  const clearRuns = useCallback(() => setRuns([]), []);

  const value = useMemo(
    () => ({ runs, addRun, clearRuns, perf, setPerf }),
    [runs, addRun, clearRuns, perf],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useStore must be used inside <StoreProvider>');
  return store;
}
