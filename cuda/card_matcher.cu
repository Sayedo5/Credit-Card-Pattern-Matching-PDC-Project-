/*
 * card_matcher.cu — the brand table, the CUDA kernel, and the C ABI that the
 * Python server loads with ctypes.
 *
 * Build:  make            (see cuda/Makefile)
 * Test:   ./card_matcher_selftest
 */

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cuda_runtime.h>

#include "card_patterns.cuh"

#define CUDA_CHECK(call)                                                       \
  do {                                                                         \
    cudaError_t _e = (call);                                                   \
    if (_e != cudaSuccess) {                                                   \
      std::snprintf(g_lastError, sizeof(g_lastError), "%s (%s:%d)",            \
                    cudaGetErrorString(_e), __FILE__, __LINE__);               \
      return -1;                                                               \
    }                                                                          \
  } while (0)

static char g_lastError[512] = "";
static char g_deviceName[256] = "";
static int g_initialised = 0;

/* ================================================================== */
/* The pattern table                                                   */
/* ================================================================== */
/*
 * Ordered most-specific-first, because the first match wins and several of
 * these ranges overlap:
 *
 *   Discover before UnionPay — 622126..622925 is the Discover-issued slice of
 *   the 62 range, so the narrower 6-digit rule has to be tested first.
 *
 *   Discover and UnionPay before Maestro — 6011, 65, 644..649 and 62 are all
 *   also covered by Maestro's blanket "6". Maestro sits last for the same
 *   reason the notebook kept its own startswith('6') catch-all last.
 */
static const CmBrandRule h_rules[CM_NUM_BRANDS] = {
    /* CM_VISA        */ {1, {{1, 4, 4}}, 2, {13, 16}},
    /* CM_MASTERCARD  */ {2, {{2, 51, 55}, {4, 2221, 2720}}, 1, {16}},
    /* CM_AMEX        */ {2, {{2, 34, 34}, {2, 37, 37}}, 1, {15}},
    /* CM_JCB         */ {1, {{4, 3528, 3589}}, 1, {16}},
    /* CM_DINERS      */ {3, {{3, 300, 305}, {2, 36, 36}, {2, 38, 38}}, 1, {14}},
    /* CM_DISCOVER    */
    {4,
     {{4, 6011, 6011}, {6, 622126, 622925}, {3, 644, 649}, {2, 65, 65}},
     1,
     {16}},
    /* CM_UNIONPAY    */ {1, {{2, 62, 62}}, 4, {16, 17, 18, 19}},
    /* CM_MAESTRO     */
    {3,
     {{2, 50, 50}, {2, 56, 58}, {1, 6, 6}},
     8,
     {12, 13, 14, 15, 16, 17, 18, 19}},
};

/*
 * Display metadata. Kept adjacent to h_rules so the two are edited together;
 * the server reads these through the C ABI so the brand list the React app
 * renders is generated from this file, not duplicated in JavaScript.
 */
typedef struct {
  const char *id;
  const char *name;
  const char *shortName;
  const char *prefixLabel;
  const char *sample; /* Luhn-valid demo number */
} CmBrandInfo;

static const CmBrandInfo h_info[CM_NUM_BRANDS] = {
    {"visa", "Visa", "VISA", "4", "4111111111111111"},
    {"mastercard", "MasterCard", "MC", "51-55, 2221-2720", "5555555555554444"},
    {"amex", "American Express", "AMEX", "34, 37", "378282246310005"},
    {"jcb", "JCB", "JCB", "3528-3589", "3566002020360505"},
    {"diners", "Diners Club", "DINERS", "300-305, 36, 38", "30569309025904"},
    {"discover", "Discover", "DISC", "6011, 622126-622925, 644-649, 65",
     "6011111111111117"},
    {"unionpay", "UnionPay", "UNIONPAY", "62", "6200000000000005"},
    {"maestro", "Maestro", "MAESTRO", "50, 56-58, 6", "6759649826438453"},
};

/*
 * The table lives in __constant__ memory: it is small (a few hundred bytes),
 * read-only, and every thread in a warp reads the same entry at the same time,
 * which is exactly the access pattern the constant cache is built for.
 */
__constant__ CmBrandRule d_rules[CM_NUM_BRANDS];

/* ================================================================== */
/* Kernel                                                              */
/* ================================================================== */
/*
 * One thread per card. Cards are stored flattened at a fixed stride of
 * CM_MAX_LEN so thread i reads at i * CM_MAX_LEN, keeping accesses aligned.
 */
__global__ void cm_match_kernel(const char *__restrict__ flat,
                                const int *__restrict__ lens, int n,
                                int *__restrict__ outBrand,
                                int *__restrict__ outLuhn,
                                int *__restrict__ outNearMiss) {
  int idx = blockIdx.x * blockDim.x + threadIdx.x;
  if (idx >= n) return;

  const char *digits = flat + (size_t)idx * CM_MAX_LEN;
  int len = lens[idx];

  int brand, nearMiss;
  cm_match(d_rules, digits, len, &brand, &nearMiss);

  outBrand[idx] = brand;
  outNearMiss[idx] = nearMiss;
  outLuhn[idx] = (len > 0 && len <= CM_MAX_LEN) ? cm_luhn(digits, len) : 0;
}

/* ================================================================== */
/* C ABI — what ctypes calls from server/app.py                        */
/* ================================================================== */
extern "C" {

const char *cm_last_error(void) { return g_lastError; }

int cm_init(void) {
  if (g_initialised) return 0;

  int count = 0;
  CUDA_CHECK(cudaGetDeviceCount(&count));
  if (count == 0) {
    std::snprintf(g_lastError, sizeof(g_lastError),
                  "no CUDA device found (this build requires an NVIDIA GPU)");
    return -1;
  }

  cudaDeviceProp prop;
  CUDA_CHECK(cudaGetDeviceProperties(&prop, 0));
  std::snprintf(g_deviceName, sizeof(g_deviceName), "%s (sm_%d%d, %d SMs)",
                prop.name, prop.major, prop.minor, prop.multiProcessorCount);

  /* Upload the pattern table into constant memory once, at startup. */
  CUDA_CHECK(cudaMemcpyToSymbol(d_rules, h_rules, sizeof(h_rules)));

  g_initialised = 1;
  return 0;
}

const char *cm_device_name(void) { return g_deviceName; }

int cm_brand_count(void) { return CM_NUM_BRANDS; }

const char *cm_brand_id(int i) { return (i >= 0 && i < CM_NUM_BRANDS) ? h_info[i].id : ""; }
const char *cm_brand_name(int i) { return (i >= 0 && i < CM_NUM_BRANDS) ? h_info[i].name : ""; }
const char *cm_brand_short(int i) { return (i >= 0 && i < CM_NUM_BRANDS) ? h_info[i].shortName : ""; }
const char *cm_brand_prefix_label(int i) { return (i >= 0 && i < CM_NUM_BRANDS) ? h_info[i].prefixLabel : ""; }
const char *cm_brand_sample(int i) { return (i >= 0 && i < CM_NUM_BRANDS) ? h_info[i].sample : ""; }

int cm_brand_length_count(int i) { return (i >= 0 && i < CM_NUM_BRANDS) ? h_rules[i].numLengths : 0; }
int cm_brand_length(int i, int k) {
  if (i < 0 || i >= CM_NUM_BRANDS || k < 0 || k >= h_rules[i].numLengths) return 0;
  return h_rules[i].lengths[k];
}

/*
 * Match a batch on the GPU. `flat` is n * CM_MAX_LEN ASCII digits.
 * `gpuMs` receives kernel time only (cudaEvent-measured, transfers excluded);
 * `totalMs` receives H2D + kernel + D2H, which is what the API actually pays.
 */
int cm_match_batch_gpu(const char *flat, const int *lens, int n, int *outBrand,
                       int *outLuhn, int *outNearMiss, double *gpuMs,
                       double *totalMs) {
  if (!g_initialised && cm_init() != 0) return -1;
  if (n <= 0) return 0;

  char *d_flat = nullptr;
  int *d_lens = nullptr, *d_brand = nullptr, *d_luhn = nullptr, *d_near = nullptr;
  cudaEvent_t evStart, evKernelStart, evKernelStop, evStop;

  CUDA_CHECK(cudaEventCreate(&evStart));
  CUDA_CHECK(cudaEventCreate(&evKernelStart));
  CUDA_CHECK(cudaEventCreate(&evKernelStop));
  CUDA_CHECK(cudaEventCreate(&evStop));

  CUDA_CHECK(cudaMalloc(&d_flat, (size_t)n * CM_MAX_LEN));
  CUDA_CHECK(cudaMalloc(&d_lens, (size_t)n * sizeof(int)));
  CUDA_CHECK(cudaMalloc(&d_brand, (size_t)n * sizeof(int)));
  CUDA_CHECK(cudaMalloc(&d_luhn, (size_t)n * sizeof(int)));
  CUDA_CHECK(cudaMalloc(&d_near, (size_t)n * sizeof(int)));

  CUDA_CHECK(cudaEventRecord(evStart));
  CUDA_CHECK(cudaMemcpy(d_flat, flat, (size_t)n * CM_MAX_LEN, cudaMemcpyHostToDevice));
  CUDA_CHECK(cudaMemcpy(d_lens, lens, (size_t)n * sizeof(int), cudaMemcpyHostToDevice));

  const int threads = 256;
  const int blocks = (n + threads - 1) / threads;

  CUDA_CHECK(cudaEventRecord(evKernelStart));
  cm_match_kernel<<<blocks, threads>>>(d_flat, d_lens, n, d_brand, d_luhn, d_near);
  CUDA_CHECK(cudaGetLastError());
  CUDA_CHECK(cudaEventRecord(evKernelStop));

  CUDA_CHECK(cudaMemcpy(outBrand, d_brand, (size_t)n * sizeof(int), cudaMemcpyDeviceToHost));
  CUDA_CHECK(cudaMemcpy(outLuhn, d_luhn, (size_t)n * sizeof(int), cudaMemcpyDeviceToHost));
  CUDA_CHECK(cudaMemcpy(outNearMiss, d_near, (size_t)n * sizeof(int), cudaMemcpyDeviceToHost));
  CUDA_CHECK(cudaEventRecord(evStop));
  CUDA_CHECK(cudaEventSynchronize(evStop));

  float kernelMs = 0.f, wholeMs = 0.f;
  CUDA_CHECK(cudaEventElapsedTime(&kernelMs, evKernelStart, evKernelStop));
  CUDA_CHECK(cudaEventElapsedTime(&wholeMs, evStart, evStop));
  if (gpuMs) *gpuMs = (double)kernelMs;
  if (totalMs) *totalMs = (double)wholeMs;

  cudaFree(d_flat);
  cudaFree(d_lens);
  cudaFree(d_brand);
  cudaFree(d_luhn);
  cudaFree(d_near);
  cudaEventDestroy(evStart);
  cudaEventDestroy(evKernelStart);
  cudaEventDestroy(evKernelStop);
  cudaEventDestroy(evStop);
  return 0;
}

/*
 * Single-threaded CPU path over the identical cm_match()/cm_luhn() code from
 * the header. This exists only as the baseline for the speedup figure — the
 * API always answers from the GPU.
 */
int cm_match_batch_cpu(const char *flat, const int *lens, int n, int *outBrand,
                       int *outLuhn, int *outNearMiss, double *cpuMs) {
  cudaEvent_t a, b;
  cudaEventCreate(&a);
  cudaEventCreate(&b);
  cudaEventRecord(a);

  for (int i = 0; i < n; ++i) {
    const char *digits = flat + (size_t)i * CM_MAX_LEN;
    int len = lens[i];
    int brand, nearMiss;
    cm_match(h_rules, digits, len, &brand, &nearMiss);
    outBrand[i] = brand;
    outNearMiss[i] = nearMiss;
    outLuhn[i] = (len > 0 && len <= CM_MAX_LEN) ? cm_luhn(digits, len) : 0;
  }

  cudaEventRecord(b);
  cudaEventSynchronize(b);
  float ms = 0.f;
  cudaEventElapsedTime(&ms, a, b);
  if (cpuMs) *cpuMs = (double)ms;
  cudaEventDestroy(a);
  cudaEventDestroy(b);
  return 0;
}

/*
 * Generate `n` synthetic cards from the brand samples (digits after the
 * prefix are randomised), run both paths, and report timings. Generating in C
 * keeps a million-card benchmark from being bottlenecked by Python.
 */
int cm_benchmark(int n, double *cpuMs, double *gpuKernelMs, double *gpuTotalMs,
                 int *matchedCount) {
  if (!g_initialised && cm_init() != 0) return -1;
  if (n <= 0) return -1;

  char *flat = (char *)std::calloc((size_t)n * CM_MAX_LEN, 1);
  int *lens = (int *)std::malloc((size_t)n * sizeof(int));
  int *b1 = (int *)std::malloc((size_t)n * sizeof(int));
  int *l1 = (int *)std::malloc((size_t)n * sizeof(int));
  int *m1 = (int *)std::malloc((size_t)n * sizeof(int));
  int *b2 = (int *)std::malloc((size_t)n * sizeof(int));
  int *l2 = (int *)std::malloc((size_t)n * sizeof(int));
  int *m2 = (int *)std::malloc((size_t)n * sizeof(int));

  if (!flat || !lens || !b1 || !l1 || !m1 || !b2 || !l2 || !m2) {
    std::snprintf(g_lastError, sizeof(g_lastError), "out of host memory for %d cards", n);
    std::free(flat); std::free(lens);
    std::free(b1); std::free(l1); std::free(m1);
    std::free(b2); std::free(l2); std::free(m2);
    return -1;
  }

  std::srand(12345); /* fixed seed so runs are comparable */
  for (int i = 0; i < n; ++i) {
    const char *sample = h_info[i % CM_NUM_BRANDS].sample;
    int len = (int)std::strlen(sample);
    char *dst = flat + (size_t)i * CM_MAX_LEN;
    for (int k = 0; k < len; ++k)
      dst[k] = (k < 6) ? sample[k] : (char)('0' + (std::rand() % 10));
    lens[i] = len;
  }

  int rc = cm_match_batch_cpu(flat, lens, n, b1, l1, m1, cpuMs);
  if (rc == 0) rc = cm_match_batch_gpu(flat, lens, n, b2, l2, m2, gpuKernelMs, gpuTotalMs);

  /* Cross-check: the GPU must agree with the CPU on every single card. */
  int matched = 0, mismatches = 0;
  for (int i = 0; i < n; ++i) {
    if (b1[i] != b2[i] || l1[i] != l2[i] || m1[i] != m2[i]) mismatches++;
    if (b2[i] >= 0) matched++;
  }
  if (mismatches > 0) {
    std::snprintf(g_lastError, sizeof(g_lastError),
                  "GPU/CPU disagreed on %d of %d cards", mismatches, n);
    rc = -1;
  }
  if (matchedCount) *matchedCount = matched;

  std::free(flat); std::free(lens);
  std::free(b1); std::free(l1); std::free(m1);
  std::free(b2); std::free(l2); std::free(m2);
  return rc;
}

} /* extern "C" */
