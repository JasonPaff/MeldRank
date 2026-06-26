import { sha256 } from '@noble/hashes/sha2.js';
import { concatBytes, lenPrefixed, utf8ToBytes } from './encoding';

/**
 * The single hash primitive and the domain-separation discipline every fairness
 * construction is built on. Each construction prepends a distinct, versioned
 * **domain tag** before hashing, so one construction's output can never be
 * replayed as another's input (e.g. a commit digest can't masquerade as an
 * assembled seed). SHA-256 from the audited, isomorphic `@noble/hashes` is used
 * synchronously — identical in Node 22 and the browser. See design D2/D3.
 */

/** SHA-256 over a byte string (synchronous, isomorphic). */
export { sha256 };

/** Commitment domain tag — binds a published `commit` to a `serverSeed`. */
export const COMMIT_TAG = 'meldrank/commit/v1';

/** Seed-assembly domain tag — mixes server, nonce, and per-seat contributions. */
export const SEED_TAG = 'meldrank/seed/v1';

/** `Rng` hash-stream domain tag — expands an assembled seed into uint32 blocks. */
export const RNG_TAG = 'meldrank/rng/v1';

/** Missing-reveal fallback domain tag — substitutes for an absent seat. */
export const FALLBACK_TAG = 'meldrank/fallback/v1';

/** Dealt-result domain tag — digests the canonical dealt hands + widow. */
export const DEAL_TAG = 'meldrank/deal/v1';

/**
 * Domain-separated SHA-256: hash the length-prefixed `tag` followed by an
 * already-canonically-encoded `body`. Every fairness digest flows through here,
 * so the tag is always present and always length-prefixed the same way.
 */
export function domainHash(tag: string, body: Uint8Array): Uint8Array {
  return sha256(concatBytes(lenPrefixed(utf8ToBytes(tag)), body));
}
