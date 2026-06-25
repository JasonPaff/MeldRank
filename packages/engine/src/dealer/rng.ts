/**
 * The injected randomness seam for the Dealer, per "Game Engine — Abstract
 * Model" §5 and design decision 3. The engine owns the *consumption* algorithm
 * (Fisher–Yates and the unbiased index draw) so the client fair-deal verifier
 * reproduces the exact permutation; the *entropy* (CSPRNG keying, commit–reveal)
 * is supplied by Match Runtime / Anti-Cheat and stays out of the zero-dependency
 * engine ("Match Runtime" §8, "Anti-Cheat" §2).
 */

/**
 * A deterministic source of randomness: a stream of unsigned 32-bit integers.
 * Match Runtime supplies a production source keyed off its provably-fair seed;
 * {@link createSeededRng} provides the engine's deterministic expansion used on
 * the replay-fold path. Fisher–Yates consumes this stream through
 * {@link boundedInt} (unbiased rejection sampling), never `% n` directly.
 */
export interface Rng {
  /** The next unsigned 32-bit integer in the stream. */
  nextUint32(): number;
}

/** Exclusive upper bound of the uint32 stream (2³²). */
const UINT32_RANGE = 0x100000000;

/**
 * Draw a uniform integer in `[0, bound)` from `rng` without modulo bias. Values
 * in the short final residue band above the largest whole multiple of `bound`
 * are rejected and redrawn, so every result is equally likely. `bound` must be a
 * positive integer ≤ 2³².
 */
export function boundedInt(rng: Rng, bound: number): number {
  // Largest multiple of `bound` that fits in the uint32 range; anything at or
  // above it would skew the distribution, so resample.
  const limit = Math.floor(UINT32_RANGE / bound) * bound;
  let x = rng.nextUint32();
  while (x >= limit) {
    x = rng.nextUint32();
  }
  return x % bound;
}

/**
 * The engine's deterministic seed → {@link Rng} expansion (a `mulberry32`
 * generator). Pure and dependency-free: the same 32-bit `seed` always yields the
 * same stream, so folding a `deal` event over `reduce` reproduces the same deal.
 * Match Runtime derives `seed` from its commit–reveal entropy; the expansion
 * itself is this one shared algorithm so client and server agree.
 */
export function createSeededRng(seed: number): Rng {
  let state = seed >>> 0;
  return {
    nextUint32(): number {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return (t ^ (t >>> 14)) >>> 0;
    },
  };
}
