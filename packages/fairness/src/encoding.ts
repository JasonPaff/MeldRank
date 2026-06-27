import { concatBytes, hexToBytes, bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

/**
 * Byte-level encoding primitives shared by every fairness construction. The
 * commit, seed assembly, `Rng` stream, fallback, and dealt-result digest all
 * hash a canonical, **length-prefixed, big-endian** byte string; the verifier
 * (browser, Match Service, bots) must reproduce these bytes exactly, so the
 * encoding is fixed here and nowhere else. See `provably-fair-shuffle` design D3.
 */

/** Encode the bytes of a UTF-8 string (isomorphic via {@link TextEncoder}). */
export { utf8ToBytes, concatBytes };

/** Lowercase-hex of a byte string — the wire/serialization form in reveal bundles. */
export const toHex = bytesToHex;

/** Parse lowercase-hex back to bytes. Throws on malformed input. */
export const fromHex = hexToBytes;

/** Encode a non-negative integer as a fixed 4-byte big-endian word. */
export function u32be(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new RangeError(`u32be expects an integer in [0, 2^32); got ${value}`);
  }
  const out = new Uint8Array(4);
  out[0] = (value >>> 24) & 0xff;
  out[1] = (value >>> 16) & 0xff;
  out[2] = (value >>> 8) & 0xff;
  out[3] = value & 0xff;
  return out;
}

/**
 * Encode a non-negative safe integer as a fixed 8-byte big-endian word. Used for
 * the `Rng` block counter, which can exceed the 32-bit range over a long stream.
 */
export function u64be(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) {
    throw new RangeError(`u64be expects an integer in [0, 2^53); got ${value}`);
  }
  const out = new Uint8Array(8);
  out.set(u32be(Math.floor(value / 0x100000000)), 0);
  out.set(u32be(value % 0x100000000), 4);
  return out;
}

/**
 * Prefix a variable-length byte field with its big-endian uint32 length, so a
 * concatenation of fields parses unambiguously and no field boundary can be
 * shifted to forge a collision between two different input tuples.
 */
export function lenPrefixed(bytes: Uint8Array): Uint8Array {
  return concatBytes(u32be(bytes.length), bytes);
}

/**
 * Read a big-endian uint32 from `block` at byte `offset`. The fixed byte order
 * is part of the spec: a 32-byte digest block yields eight uint32 words in this
 * order, and client and server must agree on the endianness exactly.
 */
export function readUint32BE(block: Uint8Array, offset: number): number {
  return (
    ((block[offset]! << 24) | (block[offset + 1]! << 16) | (block[offset + 2]! << 8) | block[offset + 3]!) >>> 0
  );
}

/** Length-and-content equality over byte strings, without short-circuiting per byte. */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i]! ^ b[i]!;
  }
  return diff === 0;
}
