/*
 * Generates CUDA_Backend.ipynb.
 *
 * The notebook is a build artifact — edit this script, then run:
 *     node tools/build_colab_notebook.mjs
 *
 * Python code below is embedded in JS template literals, so it deliberately
 * avoids backslashes (regexes use [.] instead of \. and [a-z0-9] instead of
 * \w) to remove any escaping ambiguity between the two languages.
 */
import fs from 'node:fs';

const md = (text) => ({
  cell_type: 'markdown',
  metadata: {},
  source: splitLines(text),
});

const code = (text) => ({
  cell_type: 'code',
  execution_count: null,
  metadata: {},
  outputs: [],
  source: splitLines(text),
});

function splitLines(text) {
  const lines = text.replace(/\n+$/, '').split('\n');
  return lines.map((l, i) => (i === lines.length - 1 ? l : l + '\n'));
}

const cells = [
  /* ------------------------------------------------------------------ */
  md(`# CUDA Backend — Credit Card Pattern Matching

Compiles \`cuda/card_matcher.cu\` with \`nvcc\` and serves it over HTTPS so the
React front end can send card numbers to the GPU.

**The matching algorithm lives entirely in CUDA C.** This notebook builds it,
tests it, and puts an HTTP door in front of it.

---

### Before you run anything

1. **Runtime → Change runtime type → Hardware accelerator → T4 GPU**, then Save.
2. **Push your latest commit to GitHub** — step 2 clones from there.
3. **Runtime → Run all.**

### If it stops responding later

Colab disconnects an idle session after roughly 90 minutes, and every
disconnect kills both the API and the tunnel. Run **step 7 (Status)** to see
what happened, then **step 6 (Launch)** to bring it back up. You will get a
**new tunnel URL** — paste it into the app again.

Keeping this browser tab open and visible is what prevents the idle timeout.`),

  /* ------------------------------------------------------------------ */
  md(`## 1. Configuration

Everything the rest of the notebook needs. Change these if your fork lives
somewhere else.`),

  code(`import os

REPO_URL = "https://github.com/Sayedo5/Credit-Card-Pattern-Matching-PDC-Project-.git"
BRANCH   = "main"
PORT     = 8000

# Set to True if you uploaded the cuda/ and server/ folders by hand instead
# of pushing them to GitHub.
SKIP_CLONE = False

ROOT     = "/content/" + REPO_URL.rstrip("/").split("/")[-1].removesuffix(".git")
LOG_DIR  = "/content/logs"
os.makedirs(LOG_DIR, exist_ok=True)

SERVER_LOG = LOG_DIR + "/server.log"
TUNNEL_LOG = LOG_DIR + "/tunnel.log"
URL_FILE   = LOG_DIR + "/public_url.txt"

print("repository :", REPO_URL)
print("branch     :", BRANCH)
print("checkout   :", ROOT)
print("api port   :", PORT)`),

  /* ------------------------------------------------------------------ */
  md(`## 2. Preflight — GPU and toolchain

Every later step depends on this passing. If the accelerator row says
\`none\`, go back to **Runtime → Change runtime type** and pick **T4 GPU**.`),

  code(`import subprocess


def sh(cmd, cwd=None):
    """Run a command, return (returncode, combined output)."""
    p = subprocess.run(cmd, cwd=cwd, shell=isinstance(cmd, str),
                       capture_output=True, text=True)
    return p.returncode, (p.stdout or "") + (p.stderr or "")


ok = True

rc, out = sh(["nvidia-smi", "--query-gpu=name,compute_cap,driver_version,memory.total",
              "--format=csv,noheader"])
if rc == 0 and out.strip():
    name, cap, driver, mem = [f.strip() for f in out.strip().splitlines()[0].split(",")]
    GPU_NAME, GPU_CAP = name, cap
    print(f"PASS  GPU            {name}")
    print(f"PASS  compute cap    {cap}  ->  sm_{cap.replace('.', '')}")
    print(f"PASS  driver         {driver}")
    print(f"PASS  memory         {mem}")
else:
    GPU_NAME, GPU_CAP = None, None
    print("FAIL  GPU            no NVIDIA device visible")
    print("                     Runtime -> Change runtime type -> T4 GPU")
    ok = False

rc, out = sh(["nvcc", "--version"])
if rc == 0:
    release = [l for l in out.splitlines() if "release" in l][0].strip()
    print(f"PASS  nvcc           {release}")
else:
    print("FAIL  nvcc           CUDA toolkit not found")
    ok = False

print()
print("preflight:", "OK" if ok else "FAILED — fix the above before continuing")
if not ok:
    raise SystemExit("preflight failed")`),

  /* ------------------------------------------------------------------ */
  md(`## 3. Fetch the source

Does a hard reset onto \`origin/BRANCH\`, so a stale checkout from an earlier
run can never shadow a commit you just pushed. The Colab copy is scratch —
nothing you have here is worth keeping.

Then it verifies every file the build needs actually arrived, and says exactly
which one is missing if not.`),

  code(`REQUIRED = [
    "cuda/card_patterns.cuh",
    "cuda/card_matcher.cu",
    "cuda/selftest.cu",
    "cuda/Makefile",
    "server/app.py",
]

if not SKIP_CLONE:
    if os.path.isdir(ROOT + "/.git"):
        print("updating existing checkout ...")
        for cmd in (["git", "fetch", "--quiet", "origin", BRANCH],
                    ["git", "reset", "--hard", "--quiet", "origin/" + BRANCH],
                    ["git", "clean", "-qfd"]):
            rc, out = sh(cmd, cwd=ROOT)
            if rc != 0:
                print(out)
                raise SystemExit("git step failed: " + " ".join(cmd))
    else:
        print("cloning ...")
        rc, out = sh(["git", "clone", "--quiet", "--branch", BRANCH, REPO_URL, ROOT])
        if rc != 0:
            print(out)
            raise SystemExit("clone failed — is the repository public and the branch correct?")

os.chdir(ROOT)

rc, head = sh(["git", "log", "-1", "--pretty=%h  %s  (%cr)"], cwd=ROOT)
print("HEAD:", head.strip() if rc == 0 else "unknown")
print()

missing = [p for p in REQUIRED if not os.path.isfile(os.path.join(ROOT, p))]
for path in REQUIRED:
    print(("PASS  " if path not in missing else "FAIL  ") + path)

if missing:
    print()
    print("Missing files. Either:")
    print("  a) commit and push them, then re-run this cell, or")
    print("  b) upload cuda/ and server/ into", ROOT)
    print("     using the file browser on the left, set SKIP_CLONE = True")
    print("     in step 1, and re-run.")
    raise SystemExit("source incomplete")`),

  /* ------------------------------------------------------------------ */
  md(`## 4. Compile

Targets the exact compute capability the preflight reported, so the build is
quick and produces native SASS rather than relying on a PTX JIT at load time.

Produces:

* \`libcardmatcher.so\` — the shared library the Python server loads via ctypes
* \`card_matcher_selftest\` — a standalone GPU test binary`),

  code(`import time

ARCH = f"-arch=sm_{GPU_CAP.replace('.', '')}" if GPU_CAP else ""
print("building for", ARCH or "the Makefile default (multi-arch)")
print()

sh(["make", "clean"], cwd=ROOT + "/cuda")

start = time.time()
rc, out = sh(["make", "ARCH=" + ARCH] if ARCH else ["make"], cwd=ROOT + "/cuda")
print(out.strip())

if rc != 0:
    raise SystemExit("nvcc failed — the compiler output above is the reason")

lib = ROOT + "/cuda/libcardmatcher.so"
if not os.path.isfile(lib):
    raise SystemExit("make reported success but " + lib + " is not there")

print()
print(f"built in {time.time() - start:.1f}s -> {lib} ({os.path.getsize(lib) / 1024:.0f} KB)")`),

  /* ------------------------------------------------------------------ */
  md(`## 5. GPU self-test

Every case here goes through the real kernel, not a host-side copy of the
logic. It covers one hit per rule branch in the reference table, the boundary
rejections either side of each numeric range, the per-brand length rules, and
a 1,000,000-card run that cross-checks GPU output against the CPU path card by
card.

This is the cell to trust. If it passes, the algorithm is correct on this GPU.`),

  code(`rc, out = sh(["make", "test", "ARCH=" + ARCH] if ARCH else ["make", "test"],
             cwd=ROOT + "/cuda")
print(out.strip())

if rc != 0:
    raise SystemExit("self-test failed — see above")`),

  /* ------------------------------------------------------------------ */
  md(`## 6. Launch the API and open a public tunnel

Colab cannot be reached from your laptop directly, so \`cloudflared\` opens a
temporary public HTTPS URL forwarding to port 8000 inside this VM. No account
or signup needed.

This cell is **idempotent** — it stops anything left over from a previous run
first, so you can re-run it as many times as you like.

It does not just print the tunnel URL: it fetches \`/api/health\` *through* the
tunnel and only reports success once a real request has made the full round
trip. A URL that parses but does not serve is treated as a failure.`),

  code(`import json
import re
import urllib.request

_URL_PATTERN = re.compile(r"https://[-a-z0-9]+[.]trycloudflare[.]com")


def stop_all(quiet=False):
    """Kill the API and the tunnel, if they are running."""
    for pattern in ("uvicorn app:app", "cloudflared tunnel"):
        subprocess.run(["pkill", "-f", pattern], capture_output=True)
    time.sleep(1.5)
    if not quiet:
        print("stopped any previous API / tunnel processes")


def is_running(pattern):
    return subprocess.run(["pgrep", "-f", pattern], capture_output=True).returncode == 0


def get_json(url, timeout=5):
    with urllib.request.urlopen(url, timeout=timeout) as response:
        return json.load(response)


def wait_for(url, timeout, label):
    """Poll a URL until it answers with JSON, or give up."""
    deadline = time.time() + timeout
    last = ""
    while time.time() < deadline:
        try:
            return get_json(url)
        except Exception as exc:
            last = f"{type(exc).__name__}: {exc}"
            time.sleep(1)
    print(f"  timed out after {timeout}s waiting for {label} ({last})")
    return None


def tail(path, lines=30):
    if not os.path.isfile(path):
        return "(no log at " + path + ")"
    return "".join(open(path).readlines()[-lines:])


def start_api():
    subprocess.Popen(
        ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", str(PORT)],
        cwd=ROOT + "/server",
        stdout=open(SERVER_LOG, "w"),
        stderr=subprocess.STDOUT,
    )
    health = wait_for(f"http://127.0.0.1:{PORT}/api/health", 90, "the API")
    if health is None:
        print()
        print("--- server.log ---")
        print(tail(SERVER_LOG, 40))
        raise SystemExit("the API did not start")
    return health


def start_tunnel():
    if not os.path.isfile("/usr/local/bin/cloudflared"):
        print("  installing cloudflared ...")
        sh("wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/"
           "cloudflared-linux-amd64 -O /usr/local/bin/cloudflared && "
           "chmod +x /usr/local/bin/cloudflared")

    subprocess.Popen(
        ["cloudflared", "tunnel", "--url", f"http://localhost:{PORT}", "--no-autoupdate"],
        stdout=open(TUNNEL_LOG, "w"),
        stderr=subprocess.STDOUT,
    )

    url = None
    deadline = time.time() + 60
    while time.time() < deadline and url is None:
        time.sleep(1)
        match = _URL_PATTERN.search(open(TUNNEL_LOG).read())
        if match:
            url = match.group(0)

    if url is None:
        print()
        print("--- tunnel.log ---")
        print(tail(TUNNEL_LOG, 40))
        raise SystemExit("cloudflared did not produce a URL")

    # A URL that parses is not the same as a URL that works.
    print(f"  tunnel URL issued, verifying it actually serves ...")
    if wait_for(url + "/api/health", 60, "the tunnel") is None:
        print()
        print("--- tunnel.log ---")
        print(tail(TUNNEL_LOG, 40))
        raise SystemExit("the tunnel URL never answered — re-run this cell")

    open(URL_FILE, "w").write(url)
    return url


stop_all()

print("starting API ...")
health = start_api()
print(f"  engine {health['engine']} on {health['device']}")
print(f"  {health['brands']} networks loaded from the CUDA table")

print("starting tunnel ...")
PUBLIC_URL = start_tunnel()

print()
print("=" * 72)
print()
print("   PASTE THIS INTO THE REACT APP")
print("   (click 'change' at the bottom of the panel)")
print()
print("      " + PUBLIC_URL)
print()
print("=" * 72)`),

  /* ------------------------------------------------------------------ */
  md(`## 7. Status — run this whenever the app says "offline"

Tells you which of the two processes died and shows the tail of the relevant
log. This is the first thing to run when the front end stops responding.`),

  code(`def status():
    api_up    = is_running("uvicorn app:app")
    tunnel_up = is_running("cloudflared tunnel")
    url       = open(URL_FILE).read().strip() if os.path.isfile(URL_FILE) else None

    print(f"API process     : {'running' if api_up else 'NOT running'}")
    print(f"tunnel process  : {'running' if tunnel_up else 'NOT running'}")
    print(f"last tunnel URL : {url or '(none recorded)'}")
    print()

    if api_up:
        try:
            health = get_json(f"http://127.0.0.1:{PORT}/api/health")
            print(f"local  /api/health : OK — {health['device']}")
        except Exception as exc:
            print(f"local  /api/health : FAILED — {exc}")

    if url and tunnel_up:
        try:
            health = get_json(url + "/api/health", timeout=15)
            print(f"public /api/health : OK — {health['device']}")
            print()
            print("Everything is up. If the app still says offline, make sure the")
            print("URL above is the one pasted into it — it changes every launch.")
        except Exception as exc:
            print(f"public /api/health : FAILED — {exc}")

    if not (api_up and tunnel_up):
        print()
        print("Re-run step 6 to bring it back up. You will get a NEW tunnel URL.")
        if not api_up:
            print()
            print("--- server.log ---")
            print(tail(SERVER_LOG, 25))
        if not tunnel_up:
            print()
            print("--- tunnel.log ---")
            print(tail(TUNNEL_LOG, 25))


status()`),

  /* ------------------------------------------------------------------ */
  md(`## 8. Smoke test through the tunnel

Each row is a full round trip: HTTPS → cloudflared → FastAPI → ctypes →
\`cudaMemcpy\` → kernel → back again.`),

  code(`def post(path, payload, timeout=30):
    request = urllib.request.Request(
        PUBLIC_URL + path,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response)


probes = [
    ("4111111111111111",   "Visa, 16 digits"),
    ("4222222222222",      "Visa, 13 digits"),
    ("378282246310005",    "Amex, 15 digits"),
    ("30569309025904",     "Diners Club, 14 digits"),
    ("3566002020360505",   "JCB"),
    ("6011111111111117",   "Discover"),
    ("6200000000000005",   "UnionPay"),
    ("6759649826438453",   "Maestro"),
    ("34111111111111",     "Amex prefix, wrong length"),
    ("1234567890123456",   "no brand"),
]

print(f"{'number':<20} {'result':<10} {'brand':<18} {'luhn':<6} kernel")
print("-" * 72)
for number, note in probes:
    r = post("/api/match", {"number": number})
    print(
        f"{number:<20} "
        f"{('MATCH' if r['matched'] else 'no match'):<10} "
        f"{(r['brand']['name'] if r['brand'] else '-'):<18} "
        f"{str(r['luhnValid']):<6} "
        f"{r['kernelMs']:.4f} ms"
    )`),

  /* ------------------------------------------------------------------ */
  md(`## 9. Speedup measurement

Serial CPU versus the CUDA kernel over the same one million cards, running the
identical \`cm_match()\` / \`cm_luhn()\` code from \`card_patterns.cuh\`. Results
are compared card by card, so a number here also proves the two paths agreed
on every single one.

Two speedups are reported because they answer different questions:
\`kernelSpeedup\` is the raw compute win; \`endToEndSpeedup\` includes the PCIe
transfers you actually pay for. Quote both in the report — the gap between
them is the interesting part.`),

  code(`bench = post("/api/benchmark", {"cards": 1_000_000}, timeout=180)

print("device          :", bench["device"])
print("cards           :", f"{bench['cards']:,}")
print()
print("CPU (1 thread)  :", f"{bench['cpuMs']:>10.2f} ms")
print("GPU kernel only :", f"{bench['gpuKernelMs']:>10.2f} ms",
      f"  {bench['kernelSpeedup']}x")
print("GPU + transfers :", f"{bench['gpuTotalMs']:>10.2f} ms",
      f"  {bench['endToEndSpeedup']}x")
print()
print("matched         :", f"{bench['matched']:,} / {bench['cards']:,}")
print("GPU/CPU agreement verified on every card.")`),

  /* ------------------------------------------------------------------ */
  md(`## 10. Scaling curve (optional)

Runs the benchmark across a range of batch sizes. Useful as a figure in the
report: it shows the GPU losing to the CPU on small batches, where the launch
and transfer overhead dominates, and winning once there is enough work to hide
it. The crossover point is the interesting result.`),

  code(`import matplotlib.pyplot as plt

sizes = [1_000, 10_000, 100_000, 1_000_000, 5_000_000]
cpu, gpu_kernel, gpu_total = [], [], []

for n in sizes:
    b = post("/api/benchmark", {"cards": n}, timeout=300)
    cpu.append(b["cpuMs"])
    gpu_kernel.append(b["gpuKernelMs"])
    gpu_total.append(b["gpuTotalMs"])
    print(f"{n:>10,} cards   CPU {b['cpuMs']:>9.2f} ms   "
          f"kernel {b['gpuKernelMs']:>8.2f} ms ({b['kernelSpeedup']}x)   "
          f"end-to-end {b['gpuTotalMs']:>8.2f} ms ({b['endToEndSpeedup']}x)")

fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(13, 4.5))

ax1.plot(sizes, cpu, "o-", label="CPU (1 thread)")
ax1.plot(sizes, gpu_kernel, "s-", label="GPU kernel")
ax1.plot(sizes, gpu_total, "^-", label="GPU + transfers")
ax1.set_xscale("log"); ax1.set_yscale("log")
ax1.set_xlabel("cards"); ax1.set_ylabel("time (ms)")
ax1.set_title("Runtime"); ax1.legend(); ax1.grid(alpha=0.3)

ax2.plot(sizes, [c / g for c, g in zip(cpu, gpu_kernel)], "s-", label="kernel only")
ax2.plot(sizes, [c / g for c, g in zip(cpu, gpu_total)], "^-", label="end-to-end")
ax2.axhline(1.0, color="grey", ls="--", lw=1)
ax2.set_xscale("log")
ax2.set_xlabel("cards"); ax2.set_ylabel("speedup vs CPU")
ax2.set_title(f"Speedup — {bench['device'].split('(')[0].strip()}")
ax2.legend(); ax2.grid(alpha=0.3)

plt.tight_layout()
plt.savefig("/content/cuda_speedup.png", dpi=200, bbox_inches="tight")
plt.show()
print()
print("saved to /content/cuda_speedup.png")`),

  /* ------------------------------------------------------------------ */
  md(`## 11. Shutdown

Only when you are finished — this takes the front end offline.`),

  code(`stop_all()
status()`),

  /* ------------------------------------------------------------------ */
  md(`---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| App says **GPU backend offline**, and step 7 shows both processes NOT running | The Colab session disconnected — the usual cause after it worked for a while | Re-run step 6, paste the new URL into the app |
| Step 7 shows both processes running, app still offline | The app is holding an old tunnel URL | Copy the URL from step 7 into the app's **change** field |
| Step 2 fails on the GPU row | Runtime has no accelerator | Runtime → Change runtime type → **T4 GPU** |
| Step 3 reports missing files | The commit with \`cuda/\` and \`server/\` is not on GitHub | Push it, or upload by hand and set \`SKIP_CLONE = True\` |
| Step 4 fails inside \`nvcc\` | Compile error | The compiler output above the failure names the file and line |
| Step 6 says *"the tunnel URL never answered"* | Cloudflare quick tunnels are occasionally rate-limited | Wait a minute and re-run step 6 |
| \`/api/health\` fails locally in step 7 | The server crashed, usually \`cm_init\` finding no GPU | Read \`server.log\` in the step 7 output |

**Why the URL keeps changing.** Cloudflare quick tunnels are anonymous and
disposable — a fresh hostname every launch. That is why the React app takes
the backend URL at runtime instead of baking it in at build time.`),
];

const notebook = {
  nbformat: 4,
  nbformat_minor: 0,
  metadata: {
    colab: { provenance: [], toc_visible: true },
    kernelspec: { name: 'python3', display_name: 'Python 3' },
    language_info: { name: 'python' },
    accelerator: 'GPU',
  },
  cells,
};

const out = new URL('../CUDA_Backend.ipynb', import.meta.url);
fs.writeFileSync(out, JSON.stringify(notebook, null, 1));
console.log('wrote CUDA_Backend.ipynb —', cells.length, 'cells');
