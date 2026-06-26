/**
 * `@meldrank/shared/fairness` — the pure, isomorphic commit–reveal entropy layer
 * that feeds the engine Dealer's injected `Rng` seam, making every ranked deal
 * independently auditable. Realizes the `provably-fair-shuffle` change and Match
 * Runtime — Design v1 §8.
 *
 * The protocol, end to end:
 *   1. {@link commit} the secret `serverSeed` before the deal (binds the server).
 *   2. Each seat supplies a {@link SeatContribution} (`clientSeed`); humans and
 *      bots use the identical path.
 *   3. {@link assembleSeed} mixes server + nonce + all contributions (absent seats
 *      substituted via {@link fallbackContribution}) into one full-width `seed`.
 *   4. {@link rngFromSeed} expands the seed into the engine-compatible `Rng`.
 *   5. After the hand, {@link buildRevealBundle} emits a replay-sufficient
 *      {@link RevealBundle}; anyone runs {@link verify} to reproduce the deal.
 *
 * The module is dependency-light (SHA-256 from `@noble/hashes`), keys off the full
 * 256-bit seed (no 32-bit bottleneck), and never touches Node-only or browser-only
 * crypto, so it runs byte-for-byte identically in the Match Service, the web
 * client verifier, and bots.
 */

export { commit } from './commit';
export { assembleSeed, fallbackContribution, type SeatContribution } from './assemble';
export { rngFromSeed } from './rng';
export { dealtResultDigest } from './digest';
export { buildRevealBundle, type RevealBundleInput } from './build';
export {
  RevealBundleSchema,
  SeatContributionRevealSchema,
  type RevealBundle,
  type SeatContributionReveal,
} from './bundle';
export { verify, type DealSpec, type VerifyResult, type VerifyFailureReason } from './verify';

// Low-level encoding/hash primitives and domain tags — exported for verifiers and
// tests that need to reproduce or inspect the canonical byte constructions.
export { COMMIT_TAG, SEED_TAG, RNG_TAG, FALLBACK_TAG, DEAL_TAG, domainHash, sha256 } from './hash';
export { toHex, fromHex, u32be, u64be, lenPrefixed, readUint32BE, bytesEqual } from './encoding';
