"""
FastAPI bridge between the CUDA matcher and the React front end.

This module deliberately contains NO matching logic. It marshals bytes into
libcardmatcher.so, which runs the kernel, and marshals the answer back out.
The brand table, the Luhn checksum and the prefix matching all live in
cuda/card_patterns.cuh and cuda/card_matcher.cu.

Run:
    uvicorn app:app --host 0.0.0.0 --port 8000
"""

from __future__ import annotations

import ctypes
import os
import re
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# Must match CM_MAX_LEN in cuda/card_patterns.cuh.
MAX_LEN = 19

LIB_PATH = Path(
    os.environ.get("CARDMATCHER_LIB", Path(__file__).resolve().parent.parent / "cuda" / "libcardmatcher.so")
)

_DIGITS_ONLY = re.compile(r"[^0-9]")


# --------------------------------------------------------------------------
# ctypes binding
# --------------------------------------------------------------------------
class CudaMatcher:
    """Thin ctypes wrapper over the C ABI exported by card_matcher.cu."""

    def __init__(self, lib_path: Path) -> None:
        if not lib_path.exists():
            raise RuntimeError(
                f"{lib_path} not found. Build it first:  cd cuda && make"
            )

        self.lib = ctypes.CDLL(str(lib_path))
        self._declare()

        if self.lib.cm_init() != 0:
            raise RuntimeError(f"CUDA init failed: {self.last_error()}")

        self.device: str = self.lib.cm_device_name().decode()
        self.brands: list[dict] = self._read_brand_table()

    def _declare(self) -> None:
        L = self.lib
        c_char_p, c_int, c_double = ctypes.c_char_p, ctypes.c_int, ctypes.c_double
        p_int, p_double = ctypes.POINTER(c_int), ctypes.POINTER(c_double)

        L.cm_init.restype = c_int
        L.cm_last_error.restype = c_char_p
        L.cm_device_name.restype = c_char_p
        L.cm_brand_count.restype = c_int

        for name in ("cm_brand_id", "cm_brand_name", "cm_brand_short",
                     "cm_brand_prefix_label", "cm_brand_sample"):
            fn = getattr(L, name)
            fn.argtypes = [c_int]
            fn.restype = c_char_p

        L.cm_brand_length_count.argtypes = [c_int]
        L.cm_brand_length_count.restype = c_int
        L.cm_brand_length.argtypes = [c_int, c_int]
        L.cm_brand_length.restype = c_int

        L.cm_match_batch_gpu.argtypes = [
            c_char_p, p_int, c_int, p_int, p_int, p_int, p_double, p_double,
        ]
        L.cm_match_batch_gpu.restype = c_int

        L.cm_benchmark.argtypes = [c_int, p_double, p_double, p_double, p_int]
        L.cm_benchmark.restype = c_int

    def last_error(self) -> str:
        return self.lib.cm_last_error().decode()

    def _read_brand_table(self) -> list[dict]:
        """The brand list the UI renders is generated from the CUDA source."""
        out = []
        for i in range(self.lib.cm_brand_count()):
            lengths = [
                self.lib.cm_brand_length(i, k)
                for k in range(self.lib.cm_brand_length_count(i))
            ]
            out.append(
                {
                    "index": i,
                    "id": self.lib.cm_brand_id(i).decode(),
                    "name": self.lib.cm_brand_name(i).decode(),
                    "short": self.lib.cm_brand_short(i).decode(),
                    "prefixLabel": self.lib.cm_brand_prefix_label(i).decode(),
                    "sample": self.lib.cm_brand_sample(i).decode(),
                    "lengths": lengths,
                }
            )
        return out

    def match(self, numbers: list[str]) -> tuple[list[dict], float, float]:
        """Run a batch through the kernel. Returns (results, kernel_ms, total_ms)."""
        n = len(numbers)
        flat = bytearray(n * MAX_LEN)
        lens = (ctypes.c_int * n)()

        for i, raw in enumerate(numbers):
            digits = _DIGITS_ONLY.sub("", raw)[:MAX_LEN]
            flat[i * MAX_LEN : i * MAX_LEN + len(digits)] = digits.encode()
            lens[i] = len(digits)

        brand = (ctypes.c_int * n)()
        luhn = (ctypes.c_int * n)()
        near = (ctypes.c_int * n)()
        kernel_ms = ctypes.c_double()
        total_ms = ctypes.c_double()

        rc = self.lib.cm_match_batch_gpu(
            bytes(flat), lens, n, brand, luhn, near,
            ctypes.byref(kernel_ms), ctypes.byref(total_ms),
        )
        if rc != 0:
            raise RuntimeError(f"kernel failed: {self.last_error()}")

        results = []
        for i in range(n):
            b, nm = brand[i], near[i]
            results.append(
                {
                    "digits": bytes(flat[i * MAX_LEN : i * MAX_LEN + lens[i]]).decode(),
                    "length": lens[i],
                    "matched": b >= 0,
                    "brand": self.brands[b] if b >= 0 else None,
                    "luhnValid": bool(luhn[i]),
                    "nearMiss": self.brands[nm] if nm >= 0 else None,
                }
            )
        return results, kernel_ms.value, total_ms.value

    def benchmark(self, n: int) -> dict:
        cpu_ms, k_ms, t_ms = ctypes.c_double(), ctypes.c_double(), ctypes.c_double()
        matched = ctypes.c_int()
        rc = self.lib.cm_benchmark(
            n, ctypes.byref(cpu_ms), ctypes.byref(k_ms),
            ctypes.byref(t_ms), ctypes.byref(matched),
        )
        if rc != 0:
            raise RuntimeError(self.last_error())
        return {
            "cards": n,
            "cpuMs": round(cpu_ms.value, 3),
            "gpuKernelMs": round(k_ms.value, 3),
            "gpuTotalMs": round(t_ms.value, 3),
            "kernelSpeedup": round(cpu_ms.value / k_ms.value, 1) if k_ms.value else None,
            "endToEndSpeedup": round(cpu_ms.value / t_ms.value, 1) if t_ms.value else None,
            "matched": matched.value,
        }


matcher: CudaMatcher | None = None


@asynccontextmanager
async def lifespan(_: FastAPI):
    global matcher
    matcher = CudaMatcher(LIB_PATH)
    print(f"[cardmatcher] GPU ready: {matcher.device}")
    print(f"[cardmatcher] {len(matcher.brands)} brands loaded from CUDA table")
    yield


app = FastAPI(title="Credit Card Pattern Matching (CUDA)", lifespan=lifespan)

# The React dev server runs on a different origin, and the tunnel URL changes
# every session, so allow any origin. This is a coursework demo, not a service
# holding real card data.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _require_gpu() -> CudaMatcher:
    if matcher is None:
        raise HTTPException(503, "CUDA matcher not initialised")
    return matcher


class MatchRequest(BaseModel):
    number: str = Field(..., max_length=64)


class BatchRequest(BaseModel):
    numbers: list[str] = Field(..., max_length=4096)


class BenchmarkRequest(BaseModel):
    cards: int = Field(1_000_000, ge=1, le=20_000_000)


@app.get("/api/health")
def health():
    m = _require_gpu()
    return {"status": "ok", "engine": "CUDA", "device": m.device, "brands": len(m.brands)}


@app.get("/api/brands")
def brands():
    return {"brands": _require_gpu().brands}


@app.post("/api/match")
def match(req: MatchRequest):
    m = _require_gpu()
    results, kernel_ms, total_ms = m.match([req.number])
    return {
        **results[0],
        "engine": "CUDA",
        "device": m.device,
        "kernelMs": round(kernel_ms, 4),
        "totalMs": round(total_ms, 4),
    }


@app.post("/api/match/batch")
def match_batch(req: BatchRequest):
    m = _require_gpu()
    if not req.numbers:
        raise HTTPException(400, "numbers must not be empty")
    results, kernel_ms, total_ms = m.match(req.numbers)
    return {
        "results": results,
        "engine": "CUDA",
        "device": m.device,
        "kernelMs": round(kernel_ms, 4),
        "totalMs": round(total_ms, 4),
    }


@app.post("/api/benchmark")
def benchmark(req: BenchmarkRequest):
    m = _require_gpu()
    try:
        return {"engine": "CUDA", "device": m.device, **m.benchmark(req.cards)}
    except RuntimeError as exc:
        raise HTTPException(500, str(exc)) from exc
