/*
 * Client for the CUDA backend.
 *
 * There is no matching logic in this file, or anywhere else in the browser.
 * Luhn, the prefix ranges and the brand table all live in
 * cuda/card_patterns.cuh and run on the GPU; this just carries the question
 * there and the answer back.
 */

export type ApiBrand = {
  index: number;
  id: string;
  name: string;
  short: string;
  prefixLabel: string;
  sample: string;
  lengths: number[];
};

export type MatchResponse = {
  digits: string;
  length: number;
  matched: boolean;
  brand: ApiBrand | null;
  luhnValid: boolean;
  nearMiss: ApiBrand | null;
  engine: string;
  device: string;
  kernelMs: number;
  totalMs: number;
};

export type HealthResponse = {
  status: string;
  engine: string;
  device: string;
  brands: number;
};

const STORAGE_KEY = 'cardmatcher.apiUrl';

/**
 * The Colab tunnel gets a fresh URL every session, so the address is editable
 * at runtime and remembered in localStorage. VITE_API_URL is the fallback for
 * a fixed backend (a lab machine, or a local GPU box).
 */
export function getApiUrl(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return stored;
  } catch {
    /* private mode or blocked storage — fall through to the build-time value */
  }
  return import.meta.env.VITE_API_URL ?? 'http://localhost:8000';
}

export function setApiUrl(url: string): void {
  const trimmed = url.trim().replace(/\/+$/, '');
  try {
    if (trimmed) localStorage.setItem(STORAGE_KEY, trimmed);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* not fatal — the URL still applies for this page load */
  }
}

async function request<T>(base: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${base.replace(/\/+$/, '')}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

export function checkHealth(base: string) {
  return request<HealthResponse>(base, '/api/health');
}

export function fetchBrands(base: string) {
  return request<{ brands: ApiBrand[] }>(base, '/api/brands');
}

export function matchCardNumber(base: string, number: string) {
  return request<MatchResponse>(base, '/api/match', {
    method: 'POST',
    body: JSON.stringify({ number }),
  });
}
