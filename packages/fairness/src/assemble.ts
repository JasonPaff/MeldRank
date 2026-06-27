import { concatBytes, lenPrefixed, u32be } from './encoding';
import { FALLBACK_TAG, SEED_TAG, domainHash } from './hash';

/**
 * One seat's entropy contribution: a fixed-width `clientSeed` tagged with the
 * seat that produced it. There is deliberately **no** field distinguishing a
 * human from a bot — the assembler treats every contribution identically (design
 * D8, "Uniform contribution interface"). The seed itself is 32 bytes from
 * `crypto.getRandomValues` at the call site (design D9); this module is agnostic
 * to its width and only requires determinism.
 */
export interface SeatContribution {
  readonly seat: number;
  readonly clientSeed: Uint8Array;
}

/**
 * The deterministic substitute for a seat that supplied no contribution (design
 * D6, "Missing-reveal fallback"). It derives **solely** from the already-committed
 * `serverSeed` and the seat index, so a seat dropping out gives the server no new
 * degree of freedom: its seed was fixed at commit time, and this value follows
 * from it. The output is 32 bytes, the same width as a real `clientSeed`.
 */
export function fallbackContribution(serverSeed: Uint8Array, seat: number): Uint8Array {
  return domainHash(FALLBACK_TAG, concatBytes(lenPrefixed(serverSeed), u32be(seat)));
}

/**
 * Resolve the full per-seat seed array for seats `0..seatCount-1`: each seat uses
 * its supplied `clientSeed`, or {@link fallbackContribution} when absent. Indexing
 * by seat makes assembly independent of contribution *arrival* order. Rejects
 * out-of-range and duplicate seat indices — a malformed contribution set is a
 * caller fault, not a silently-tolerated input.
 */
function resolveSeatSeeds(serverSeed: Uint8Array, contributions: readonly SeatContribution[], seatCount: number): Uint8Array[] {
  if (!Number.isInteger(seatCount) || seatCount <= 0) {
    throw new RangeError(`seatCount must be a positive integer; got ${seatCount}`);
  }
  const supplied = new Array<Uint8Array | undefined>(seatCount);
  for (const contribution of contributions) {
    const { seat } = contribution;
    if (!Number.isInteger(seat) || seat < 0 || seat >= seatCount) {
      throw new RangeError(`contribution seat ${seat} is out of range [0, ${seatCount})`);
    }
    if (supplied[seat] !== undefined) {
      throw new Error(`duplicate contribution for seat ${seat}`);
    }
    supplied[seat] = contribution.clientSeed;
  }
  const resolved: Uint8Array[] = [];
  for (let seat = 0; seat < seatCount; seat++) {
    resolved.push(supplied[seat] ?? fallbackContribution(serverSeed, seat));
  }
  return resolved;
}

/**
 * Assemble the single `seed` that keys the deal, per design D3 and the
 * "Multi-party seed assembly" requirement. The seed is a domain-separated
 * SHA-256 over a canonical, length-prefixed encoding of: the `handNonce`, the
 * `serverSeed`, the seat count, and every seat's contribution in **ascending
 * seat order** (absent seats substituted via {@link fallbackContribution}).
 *
 * Because the encoding folds in every party's input, no single party — including
 * the server — can drive the seed to a chosen value without finding a SHA-256
 * preimage; because seats are encoded by index, arrival order does not change the
 * result; and because the `handNonce` is mixed in, each hand of a match derives
 * an independent seed.
 */
export function assembleSeed(
  serverSeed: Uint8Array,
  handNonce: number,
  contributions: readonly SeatContribution[],
  seatCount: number,
): Uint8Array {
  const seatSeeds = resolveSeatSeeds(serverSeed, contributions, seatCount);
  const parts: Uint8Array[] = [u32be(handNonce), lenPrefixed(serverSeed), u32be(seatCount)];
  for (let seat = 0; seat < seatCount; seat++) {
    parts.push(u32be(seat), lenPrefixed(seatSeeds[seat]!));
  }
  return domainHash(SEED_TAG, concatBytes(...parts));
}
