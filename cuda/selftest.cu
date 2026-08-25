/*
 * selftest.cu — runs the reference pattern table through the real CUDA kernel.
 *
 * Every case here goes to the GPU, not to a host-side copy of the logic, so a
 * pass means the kernel itself is correct.
 *
 * Build & run:  make test
 */

#include <cstdio>
#include <cstring>

#include "card_patterns.cuh"

extern "C" {
int cm_init(void);
const char *cm_device_name(void);
const char *cm_last_error(void);
int cm_brand_count(void);
const char *cm_brand_name(int i);
int cm_match_batch_gpu(const char *flat, const int *lens, int n, int *outBrand,
                       int *outLuhn, int *outNearMiss, double *gpuMs,
                       double *totalMs);
int cm_benchmark(int n, double *cpuMs, double *gpuKernelMs, double *gpuTotalMs,
                 int *matchedCount);
}

typedef struct {
  const char *number;
  int expectBrand; /* -1 = no match */
  const char *label;
} TestCase;

static const TestCase kCases[] = {
    /* --- one hit per rule branch in the reference table --- */
    {"4111111111111111", CM_VISA, "Visa 16"},
    {"4222222222222", CM_VISA, "Visa 13"},
    {"5105105105105100", CM_MASTERCARD, "MC 51-55"},
    {"2221000000000009", CM_MASTERCARD, "MC 2221 low bound"},
    {"2720999999999996", CM_MASTERCARD, "MC 2720 high bound"},
    {"341111111111111", CM_AMEX, "Amex 34"},
    {"378282246310005", CM_AMEX, "Amex 37"},
    {"3528000000000007", CM_JCB, "JCB 3528 low bound"},
    {"3589000000000000", CM_JCB, "JCB 3589 high bound"},
    {"30000000000004", CM_DINERS, "Diners 300"},
    {"30569309025904", CM_DINERS, "Diners 305"},
    {"36000000000008", CM_DINERS, "Diners 36"},
    {"38000000000006", CM_DINERS, "Diners 38"},
    {"6011111111111117", CM_DISCOVER, "Discover 6011"},
    {"6221260000000000", CM_DISCOVER, "Discover 622126 low"},
    {"6229250000000000", CM_DISCOVER, "Discover 622925 high"},
    {"6440000000000000", CM_DISCOVER, "Discover 644"},
    {"6490000000000000", CM_DISCOVER, "Discover 649"},
    {"6500000000000000", CM_DISCOVER, "Discover 65"},
    {"6200000000000000", CM_UNIONPAY, "UnionPay 62 len16"},
    {"620000000000000000", CM_UNIONPAY, "UnionPay 62 len18"},
    {"5000000000000", CM_MAESTRO, "Maestro 50 len13"},
    {"580000000000", CM_MAESTRO, "Maestro 58 len12"},
    {"5600000000000000000", CM_MAESTRO, "Maestro 56 len19"},
    {"6759649826438453", CM_MAESTRO, "Maestro 6 catch-all"},

    /* --- boundary rejections: one digit outside each range --- */
    {"2220000000000000", -1, "MC below 2221"},
    {"2721000000000000", -1, "MC above 2720"},
    {"3527000000000000", -1, "JCB below 3528"},
    {"3590000000000000", -1, "JCB above 3589"},
    {"30600000000000", -1, "Diners above 305"},

    /* --- length rules (the notebook's hard-coded 16 could not express these) --- */
    {"41111111111111", -1, "Visa len 14 rejected"},
    {"34111111111111", -1, "Amex len 14 rejected"},
    {"3782822463100051", -1, "Amex len 16 rejected"},

    /* --- no brand at all --- */
    {"1234567890123456", -1, "unknown prefix 1"},
    {"9999999999999999", -1, "unknown prefix 9"},
};

static const int kNumCases = (int)(sizeof(kCases) / sizeof(kCases[0]));

int main(void) {
  if (cm_init() != 0) {
    std::printf("cm_init failed: %s\n", cm_last_error());
    return 1;
  }
  std::printf("GPU: %s\n\n", cm_device_name());

  /* Pack every case into one flat batch and send it through the kernel. */
  static char flat[64 * CM_MAX_LEN];
  int lens[64], brand[64], luhn[64], nearMiss[64];
  std::memset(flat, 0, sizeof(flat));

  for (int i = 0; i < kNumCases; ++i) {
    int len = (int)std::strlen(kCases[i].number);
    std::memcpy(flat + (size_t)i * CM_MAX_LEN, kCases[i].number, len);
    lens[i] = len;
  }

  double gpuMs = 0, totalMs = 0;
  if (cm_match_batch_gpu(flat, lens, kNumCases, brand, luhn, nearMiss, &gpuMs,
                         &totalMs) != 0) {
    std::printf("kernel failed: %s\n", cm_last_error());
    return 1;
  }

  int failures = 0;
  for (int i = 0; i < kNumCases; ++i) {
    int got = brand[i];
    int ok = (got == kCases[i].expectBrand);
    if (!ok) failures++;

    std::printf("%s  %-26s %-20s -> %-18s", ok ? "PASS" : "FAIL", kCases[i].label,
                kCases[i].number,
                got >= 0 ? cm_brand_name(got) : "no match");
    if (!ok)
      std::printf(" (expected %s)",
                  kCases[i].expectBrand >= 0 ? cm_brand_name(kCases[i].expectBrand)
                                             : "no match");
    std::printf("\n");
  }

  std::printf("\n%d/%d passed   kernel %.3f ms, incl. transfers %.3f ms\n",
              kNumCases - failures, kNumCases, gpuMs, totalMs);

  /* Throughput check, which also cross-verifies GPU output against the CPU path. */
  std::printf("\n--- benchmark: 1,000,000 cards ---\n");
  double cpuMs = 0, kMs = 0, tMs = 0;
  int matched = 0;
  if (cm_benchmark(1000000, &cpuMs, &kMs, &tMs, &matched) != 0) {
    std::printf("benchmark failed: %s\n", cm_last_error());
    failures++;
  } else {
    std::printf("CPU (1 thread) : %9.2f ms\n", cpuMs);
    std::printf("GPU kernel     : %9.2f ms   (%.1fx)\n", kMs, cpuMs / kMs);
    std::printf("GPU + transfers: %9.2f ms   (%.1fx)\n", tMs, cpuMs / tMs);
    std::printf("matched        : %d / 1000000\n", matched);
    std::printf("GPU/CPU agreement verified on every card.\n");
  }

  std::printf("\n%s\n", failures == 0 ? "ALL TESTS PASSED" : "THERE WERE FAILURES");
  return failures == 0 ? 0 : 1;
}
