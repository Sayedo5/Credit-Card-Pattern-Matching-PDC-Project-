/*
 * One "MPI rank". The master posts a chunk of cards, this worker validates
 * them on its own thread, and posts the results back — the browser equivalent
 * of `comm.send` / `comm.recv` in MPI_CreditCardValidator.validate_batch_mpi.
 *
 * It imports the same core module the serial path uses, so both engines run
 * identical logic.
 */

import { detectCardType, validateCardNumber, validateCvv, validateExpiry } from '../core/validation';
import { matchBrand } from '../core/validation';
import type { BatchResult, CardRecord } from '../core/types';

export type WorkerRequest = { id: number; rank: number; cards: CardRecord[] };
export type WorkerResponse = { id: number; rank: number; results: BatchResult[] };

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { id, rank, cards } = event.data;
  const results: BatchResult[] = [];

  for (const card of cards) {
    const numberResult = validateCardNumber(card.number);
    const { brand } = matchBrand(card.number);
    const cvvResult = validateCvv(card.cvv, brand);
    const expiryResult = validateExpiry(card.expiry);

    if (numberResult.ok && cvvResult.ok && expiryResult.ok && numberResult.cleaned) {
      results.push({
        card: card.number,
        valid: true,
        type: detectCardType(numberResult.cleaned),
      });
    } else {
      results.push({ card: card.number, valid: false, type: 'Invalid' });
    }
  }

  const response: WorkerResponse = { id, rank, results };
  self.postMessage(response);
};
