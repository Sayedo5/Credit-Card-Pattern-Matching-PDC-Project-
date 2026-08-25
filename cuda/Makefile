# Build the CUDA matcher.
#
#   make            -> libcardmatcher.so  (loaded by server/app.py via ctypes)
#   make test       -> build and run the GPU self-test
#   make clean
#
# ARCH targets the GPUs this project is actually run on:
#   sm_75 = Turing  (Colab T4)
#   sm_80 = Ampere  (A100)
#   sm_86 = Ampere  (RTX 30xx, Colab L4 is sm_89)
# Override on the command line if needed:  make ARCH=-arch=sm_89

NVCC    ?= nvcc
ARCH    ?= -gencode arch=compute_75,code=sm_75 \
           -gencode arch=compute_80,code=sm_80 \
           -gencode arch=compute_86,code=sm_86 \
           -gencode arch=compute_86,code=compute_86
NVCCFLAGS ?= -O3 -std=c++14 $(ARCH)

LIB     := libcardmatcher.so
TEST    := card_matcher_selftest

.PHONY: all test clean

all: $(LIB)

$(LIB): card_matcher.cu card_patterns.cuh
	$(NVCC) $(NVCCFLAGS) -Xcompiler -fPIC -shared -o $@ card_matcher.cu

$(TEST): selftest.cu card_matcher.cu card_patterns.cuh
	$(NVCC) $(NVCCFLAGS) -o $@ selftest.cu card_matcher.cu

test: $(TEST)
	./$(TEST)

clean:
	rm -f $(LIB) $(TEST)
