# Credit Card Pattern Matching — PDC Project

Detects a credit card's issuing network from its number. **The matching
algorithm runs as a CUDA kernel on an NVIDIA GPU.** The React app is the
front end only — it formats the input and renders what the kernel returns.

```
   React (your PC)                CUDA C (NVIDIA GPU)
   ┌────────────────┐             ┌──────────────────────┐
   │ input format   │  HTTPS      │ cm_match_kernel<<<>>> │
   │ result display │ ──────────► │  · Luhn checksum      │
   │                │  tunnel     │  · prefix ranges      │
   └────────────────┘             │  · brand table        │
          ▲                       └──────────────────────┘
          │                                 ▲
          └───── FastAPI ── ctypes ──────────┘
                 server/app.py    libcardmatcher.so
```

Nothing is matched in the browser. If the GPU backend is unreachable the app
says **GPU backend offline** and refuses to guess.

| Folder | Contents |
|---|---|
| `cuda/` | The algorithm. Brand table, Luhn, prefix matching, the kernel. |
| `server/` | FastAPI wrapper. Loads `libcardmatcher.so` via ctypes. No matching logic. |
| `web/` | React + TypeScript UI. No matching logic. |
| `PDC_Project.ipynb` | The original coursework notebook — MPI + CUDA simulation. **Unchanged.** |
| `CUDA_Backend.ipynb` | Colab notebook that builds the CUDA and serves it. |

---

## Running it

You need an NVIDIA GPU. This project was set up to use Colab's free T4.

### 1. Start the GPU backend (Colab)

1. Push your latest commit to GitHub.
2. Open `CUDA_Backend.ipynb` in [Colab](https://colab.research.google.com).
3. Click the **▾ next to "Connect" → Change runtime type → T4 GPU → Save**,
   then click the plain **Connect** button. Without a GPU runtime, `cm_init()`
   fails at startup with *"no CUDA device found"*.
4. **Runtime → Run all.**

> **Do not use "Connect to a local runtime".** It opens a *Local connection
> settings* dialog asking for a Backend URL like `http://localhost:8888/?token=…`.
> That is a Jupyter server on your own machine and is unrelated to this
> project — and a laptop without an NVIDIA GPU cannot run the kernel anyway.
> The tunnel URL this notebook prints goes into the **React app**, never into
> a Colab dialog.

The notebook runs a preflight check, hard-resets the checkout onto your latest
push, compiles for the exact compute capability of the GPU it was given, runs
the self-test, starts FastAPI, and opens a public
`https://….trycloudflare.com` tunnel. It prints that URL in a box — copy it.

### When it stops responding

Colab disconnects an idle session after roughly 90 minutes, and that kills both
the API and the tunnel. This is the usual reason a backend that was working
goes quiet.

Run **step 7 (Status)** in the notebook. It reports which of the two processes
died, tails the relevant log, and re-checks `/api/health` both locally and
through the tunnel. Then re-run **step 6 (Launch)** — it is idempotent, so it
cleans up whatever is left over and starts fresh.

**You will get a new tunnel URL every launch.** Cloudflare quick tunnels are
anonymous and disposable, which is exactly why the app takes the backend
address at runtime instead of baking it in at build time. Paste the new one
into the app's **change** field.

### 2. Start the front end (your PC)

```bash
cd web
npm install
npm run dev
```

Open http://localhost:5173/, click **change** at the bottom of the panel, and
paste the tunnel URL. The status dot turns green and shows the GPU name.

> The Colab tunnel URL changes every session, which is why the app lets you
> paste a new one at runtime instead of only reading `VITE_API_URL`. Set
> `web/.env` from `web/.env.example` if you have a fixed backend address.

### Building natively instead of in Colab

On any machine with an NVIDIA GPU and the CUDA toolkit:

```bash
cd cuda && make && make test          # builds libcardmatcher.so, runs the GPU tests
cd ../server && pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8000
```

Then point the app at `http://localhost:8000`.

---

## The algorithm

`cuda/card_patterns.cuh` is the single source of truth. It ports the notebook's
`CreditCardSystem`, which does two things:

**1. `validate_card_number` — the Luhn checksum.** Walk the digits in reverse,
double every second one, subtract 9 when a doubled digit exceeds 9, check the
total is divisible by 10. Ported as `cm_luhn()`.

**2. `detect_card_type` — prefix matching.** The notebook tests prefixes in two
shapes:

```python
card_number.startswith('4')            # first 1 digit  == 4
51 <= int(card_number[:2]) <= 55       # first 2 digits in [51, 55]
```

Both are the *same operation*: slice the first N digits, read as an integer,
test a closed range. A `startswith` is just the range where `from == to`. So
the port expresses that one comparison as data:

```c
typedef struct { int digits; int from; int to; } CmPrefixRange;

{1, 4,  4 }    /* startswith('4')             */
{2, 51, 55}    /* 51 <= int(n[:2]) <= 55      */
```

Adding a network is a new row in `h_rules[]`, not a new branch. There is no
regex anywhere in the detection path. Brands are evaluated **in order, first
match wins** — the same control flow as the notebook's `if`/`elif` chain.

Every function is `__host__ __device__`, so the GPU kernel and the CPU
reference path (the baseline for the speedup number) execute *the same code*.
There is no second implementation that can drift.

### What the GPU actually does

One thread per card. `cm_match_kernel` reads from a flat buffer at a fixed
stride of 19 bytes so accesses stay aligned. The brand table lives in
`__constant__` memory — it is a few hundred bytes, read-only, and every thread
in a warp reads the same entry at the same time, which is exactly what the
constant cache is for.

`cm_benchmark()` runs both paths over the same million cards and compares them
**card by card**, so the reported speedup also proves the two agree.

---

## Card networks

The notebook covered four brands and hard-coded `^\d{16}$`. That length gate
had a consequence worth calling out: **American Express could never match**,
because 34/37 numbers are 15 digits and were rejected before
`detect_card_type` ever ran. Discover also matched *any* number starting `6`.

All eight networks are now in the CUDA table, with per-brand length rules.

| Network | Starts with | Length | In original notebook |
|---|---|---|---|
| Visa | 4 | 13 or 16 | Yes — 16 only |
| MasterCard | 51–55, 2221–2720 | 16 | Partly — 51–55 only |
| American Express | 34, 37 | 15 | Present but unreachable |
| Discover | 6011, 622126–622925, 644–649, 65 | 16 | Partly — matched any `6` |
| Diners Club | 300–305, 36, 38 | 14 | **Added** |
| JCB | 3528–3589 | 16 | **Added** |
| Maestro | 50, 56–58, 6 | 12–19 | **Added** |
| UnionPay | 62 | 16–19 | **Added** |

Overlaps are resolved by table order, most-specific-first:

- **Discover before UnionPay** — `622126–622925` is the Discover-issued slice
  of the `62` range, so the narrower 6-digit rule is tested first.
- **Discover and UnionPay before Maestro** — `6011`, `65`, `644–649` and `62`
  are all also covered by Maestro's blanket `6`. Maestro sits last for the
  same reason the notebook kept its own `startswith('6')` catch-all last.

### One bug fixed from the notebook's kernel sketch

`generate_cuda_kernel_code()` in the notebook emits a kernel that holds the
card in a `long long` and peels digits with `temp % 10`. A 19-digit Maestro or
UnionPay number reaches ~1.0 × 10¹⁹; `long long` tops out at ~9.22 × 10¹⁸, so
those numbers silently overflow. The real kernel keeps digits as ASCII
characters throughout and never converts the whole number to an integer.

---

## API

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | GPU name, engine, brand count |
| `GET /api/brands` | The brand table, read out of the CUDA source |
| `POST /api/match` | `{"number": "4111111111111111"}` → brand, Luhn, near-miss, kernel ms |
| `POST /api/match/batch` | Up to 4096 numbers in one kernel launch |
| `POST /api/benchmark` | CPU vs GPU over N cards, with agreement check |

The brand list the React app renders comes from `/api/brands`, which reads
`h_info[]` and `h_rules[]` out of the compiled library. The networks shown in
the UI are generated from the CUDA source rather than duplicated in
JavaScript.

---

## Testing

```bash
cd cuda && make test
```

Runs 35 cases through the real kernel: one hit per rule branch in the table,
the boundary rejections either side of every numeric range (`2220`/`2721`,
`3527`/`3590`, `306`), the per-brand length rules, and unknown prefixes. Then
a 1,000,000-card benchmark that cross-checks every GPU result against the CPU
path.

Step 5 of `CUDA_Backend.ipynb` runs the same thing in Colab.

### Editing the Colab notebook

`CUDA_Backend.ipynb` is a generated artifact. Edit
`tools/build_colab_notebook.mjs` and regenerate:

```bash
node tools/build_colab_notebook.mjs
```

Hand-editing the `.ipynb` works but the next regeneration overwrites it.

---

## Project layout

```
.
├── PDC_Project.ipynb          # original coursework notebook (unchanged)
├── CUDA_Backend.ipynb         # Colab: build the CUDA, serve it, tunnel it
│                              #   (generated — edit the script below instead)
├── tools/
│   └── build_colab_notebook.mjs

├── cuda/
│   ├── card_patterns.cuh      # THE ALGORITHM — table, Luhn, prefix matching
│   ├── card_matcher.cu        # kernel, brand table, C ABI, CPU baseline
│   ├── selftest.cu            # GPU test binary
│   └── Makefile
├── server/
│   ├── app.py                 # FastAPI + ctypes. No matching logic.
│   └── requirements.txt
└── web/
    ├── .env.example
    ├── package.json
    └── src/
        ├── App.tsx            # the single-page UI
        ├── api.ts             # HTTP client. No matching logic.
        ├── format.ts          # digit grouping. Cosmetic only.
        ├── index.css
        └── components/BrandMark.tsx
```

## Running the original notebook

Unchanged. Open `PDC_Project.ipynb` in Colab and run the cells in order. Note
that its `STEP 6` cell opens an interactive `input()` menu and will wait until
you type `8` to exit.
