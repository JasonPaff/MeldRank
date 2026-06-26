import { describe, expect, it } from 'vitest';
import { sha256 } from './hash';
import { bytesEqual, fromHex, lenPrefixed, readUint32BE, toHex, u32be, u64be, utf8ToBytes } from './encoding';

describe('SHA-256 known-answer vectors (pin the hash primitive)', () => {
  // Published NIST/FIPS-180-4 test vectors. If these drift, the whole fairness
  // layer's byte-for-byte cross-environment guarantee is broken.
  it('hashes the empty string to its published digest', () => {
    expect(toHex(sha256(utf8ToBytes('')))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('hashes "abc" to its published digest', () => {
    expect(toHex(sha256(utf8ToBytes('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('hashes the 448-bit FIPS example to its published digest', () => {
    const message = 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq';
    expect(toHex(sha256(utf8ToBytes(message)))).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  });
});

describe('big-endian integer encodings', () => {
  it('encodes uint32 big-endian', () => {
    expect(Array.from(u32be(0x01020304))).toEqual([1, 2, 3, 4]);
    expect(Array.from(u32be(0))).toEqual([0, 0, 0, 0]);
    expect(Array.from(u32be(0xffffffff))).toEqual([255, 255, 255, 255]);
  });

  it('rejects out-of-range uint32 values', () => {
    expect(() => u32be(-1)).toThrow(RangeError);
    expect(() => u32be(0x100000000)).toThrow(RangeError);
    expect(() => u32be(1.5)).toThrow(RangeError);
  });

  it('encodes uint64 big-endian across the 32-bit boundary', () => {
    expect(Array.from(u64be(1))).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    // 0x0102030405 needs the high word: floor / 2^32 = 1, low = 0x02030405.
    expect(Array.from(u64be(0x0102030405))).toEqual([0, 0, 0, 1, 2, 3, 4, 5]);
  });

  it('round-trips uint32 through readUint32BE without sign error', () => {
    expect(readUint32BE(u32be(0x01020304), 0)).toBe(0x01020304);
    // High bit set must stay unsigned, not become negative.
    expect(readUint32BE(u32be(0xffffffff), 0)).toBe(0xffffffff);
    expect(readUint32BE(u32be(0x80000000), 0)).toBe(0x80000000);
  });

  it('reads uint32 words at an offset within a block', () => {
    const block = new Uint8Array([0, 0, 0, 0, 0xaa, 0xbb, 0xcc, 0xdd]);
    expect(readUint32BE(block, 4)).toBe(0xaabbccdd);
  });
});

describe('length-prefixed framing', () => {
  it('prefixes a field with its big-endian uint32 length', () => {
    expect(Array.from(lenPrefixed(new Uint8Array([0xaa, 0xbb])))).toEqual([0, 0, 0, 2, 0xaa, 0xbb]);
    expect(Array.from(lenPrefixed(new Uint8Array([])))).toEqual([0, 0, 0, 0]);
  });

  it('disambiguates field boundaries (no shifting collision)', () => {
    // ["a","bc"] and ["ab","c"] concatenate to the same raw bytes but differ once
    // length-prefixed — the property that makes the canonical encoding injective.
    const ab = utf8ToBytes('a');
    const bc = utf8ToBytes('bc');
    const abc = utf8ToBytes('ab');
    const c = utf8ToBytes('c');
    const left = toHex(lenPrefixed(ab)) + toHex(lenPrefixed(bc));
    const right = toHex(lenPrefixed(abc)) + toHex(lenPrefixed(c));
    expect(left).not.toBe(right);
  });
});

describe('hex round-trip and byte equality', () => {
  it('round-trips bytes through hex', () => {
    const bytes = new Uint8Array([0x00, 0x0f, 0xa0, 0xff]);
    expect(Array.from(fromHex(toHex(bytes)))).toEqual([0x00, 0x0f, 0xa0, 0xff]);
  });

  it('compares byte strings by length and content', () => {
    expect(bytesEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
    expect(bytesEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
    expect(bytesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(false);
  });
});
