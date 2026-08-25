export type PrefixRange = {
  /** How many leading digits to read (the `[:N]` slice). */
  digits: number;
  from: number;
  to: number;
};

export type CardBrand = {
  id: string;
  name: string;
  short: string;
  color: string;
  prefixLabel: string;
  /** First match wins, so order in CARD_BRANDS is significant. */
  prefixes: PrefixRange[];
  lengths: number[];
  /** Luhn-valid demo number. */
  sample: string;
};

/** One card as the notebook models it: name, number, cvv, expiry. */
export type CardRecord = {
  name: string;
  number: string;
  cvv: string;
  expiry: string;
};

export type CheckResult = {
  ok: boolean;
  message: string;
};

export type ValidationReport = {
  number: CheckResult & { cleaned: string | null };
  cvv: CheckResult;
  expiry: CheckResult;
  brand: CardBrand | null;
  /** Prefix matched a brand but the length did not — used to explain near misses. */
  nearMiss: CardBrand | null;
  luhnValid: boolean;
  valid: boolean;
};

/** One row of a batch run — mirrors the dicts the notebook appends. */
export type BatchResult = {
  card: string;
  valid: boolean;
  type: string;
};

export type EngineId = 'serial' | 'mpi' | 'gpu';

export type EngineRun = {
  engine: EngineId;
  label: string;
  results: BatchResult[];
  /** Milliseconds. */
  time: number;
  /** Populated by the MPI engine: how many cards each worker handled. */
  chunks?: number[];
  /** Populated by the GPU engine: how the modelled time was derived. */
  model?: GpuModel;
};

export type GpuModel = {
  threads: number;
  warps: number;
  launchOverheadMs: number;
  measuredComputeMs: number;
};
