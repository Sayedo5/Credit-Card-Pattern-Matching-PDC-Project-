/*
 * The CUDA kernel from `CUDA_Simulator.generate_cuda_kernel_code()` in
 * PDC_Project.ipynb, reproduced verbatim so the GPU view shows the same
 * source the notebook does.
 *
 * It carries a real defect, called out in the UI beside it — see KERNEL_NOTES.
 */

export const CUDA_KERNEL_SOURCE = String.raw`// CUDA KERNEL FOR CREDIT CARD VALIDATION
__global__ void validate_cards_kernel(long long* card_numbers,
                                      int* cvv_numbers,
                                      int* results,
                                      int* card_types,
                                      int num_cards) {

    int idx = blockIdx.x * blockDim.x + threadIdx.x;
    if (idx >= num_cards) return;

    long long card_num = card_numbers[idx];
    int cvv = cvv_numbers[idx];

    // Luhn Algorithm Implementation on GPU
    int total = 0;
    bool alternate = false;
    long long temp = card_num;

    while (temp > 0) {
        int digit = temp % 10;
        temp /= 10;

        if (alternate) {
            digit *= 2;
            if (digit > 9) digit -= 9;
        }

        total += digit;
        alternate = !alternate;
    }

    // Check validity
    int valid = (total % 10 == 0) ? 1 : 0;

    // CVV validation
    if (cvv < 100 || cvv > 999) valid = 0;

    // Card type detection
    int first_two = card_num;
    while (first_two >= 100) first_two /= 10;

    int ctype = 0; // Unknown
    if (first_two >= 40 && first_two < 50) ctype = 1; // Visa
    else if (first_two >= 51 && first_two <= 55) ctype = 2; // MasterCard
    else if (first_two == 34 || first_two == 37) ctype = 3; // Amex
    else if (first_two >= 60 && first_two < 65) ctype = 4; // Discover

    results[idx] = valid;
    card_types[idx] = ctype;
}`;

export type KernelNote = {
  title: string;
  detail: string;
};

export const KERNEL_NOTES: KernelNote[] = [
  {
    title: 'long long overflows at 19 digits',
    detail:
      'The kernel holds the card in a long long and peels digits with temp % 10. A 19-digit Maestro or UnionPay number reaches ~1.0 × 10^19; long long tops out at ~9.22 × 10^18, so those numbers wrap silently. Keeping the digits as characters avoids the conversion entirely.',
  },
  {
    title: 'int first_two = card_num truncates',
    detail:
      'Assigning a long long to an int is implementation-defined once the value exceeds INT_MAX, which every 16-digit card does. The prefix it then derives is garbage.',
  },
  {
    title: 'Leading zeros are unrecoverable',
    detail:
      'Once a card number is an integer, a leading zero is gone. No card network in the reference table starts with 0, but the representation cannot express it either way.',
  },
  {
    title: 'Only four networks, no length rules',
    detail:
      'The prefix ladder covers Visa, MasterCard, Amex and Discover, and never checks the total length — so it cannot distinguish a 15-digit Amex from a 16-digit number sharing its prefix, nor recognise JCB, Diners Club, Maestro or UnionPay.',
  },
];
