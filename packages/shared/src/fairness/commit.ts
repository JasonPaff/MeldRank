import { lenPrefixed } from './encoding';
import { COMMIT_TAG, domainHash } from './hash';

/**
 * The pre-deal commitment, per `provably-fair-shuffle` design D3 and the
 * "Server seed commitment binds before the deal" requirement. The server
 * publishes `commit(serverSeed)` *before* any card is dealt; because SHA-256 is
 * preimage- and collision-resistant, publishing the digest binds the server to
 * that exact `serverSeed` without revealing it, and the server cannot later
 * substitute a different seed that still satisfies the published commit.
 */
export function commit(serverSeed: Uint8Array): Uint8Array {
  return domainHash(COMMIT_TAG, lenPrefixed(serverSeed));
}
