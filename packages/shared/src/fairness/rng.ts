import type { Rng } from '@meldrank/engine';
import { concatBytes, lenPrefixed, readUint32BE, u64be } from './encoding';
import { RNG_TAG, domainHash } from './hash';

/** Each 32-byte SHA-256 block yields eight big-endian uint32 words. */
const WORDS_PER_BLOCK = 8;

/**
 * Derive a deterministic {@link Rng} from a full-width assembled `seed`, per
 * design D3/D5 and the "Full-width Rng derivation feeds the engine Dealer"
 * requirement. This is a hash-stream DRBG: block `k` is
 * `H("meldrank/rng/v1" ‖ seed ‖ uint64(k))`, and each block is sliced into eight
 * big-endian uint32 words consumed in order, advancing `k` as the stream drains.
 *
 * The construction keys off the **entire** seed (the whole 32 bytes feed every
 * block), deliberately bypassing the engine's 32-bit `createSeededRng` so the
 * reachable outcome space is not bottlenecked to 2³² — every deck permutation
 * stays reachable (design D5). The returned object plugs straight into the engine
 * `deal(deckSpec, handSize, widowSize, rng)`.
 */
export function rngFromSeed(seed: Uint8Array): Rng {
  let block: Uint8Array = new Uint8Array(0);
  let wordIndex = WORDS_PER_BLOCK; // force a block fill on the first draw
  let counter = 0;
  return {
    nextUint32(): number {
      if (wordIndex >= WORDS_PER_BLOCK) {
        block = domainHash(RNG_TAG, concatBytes(lenPrefixed(seed), u64be(counter)));
        counter += 1;
        wordIndex = 0;
      }
      const word = readUint32BE(block, wordIndex * 4);
      wordIndex += 1;
      return word;
    },
  };
}
