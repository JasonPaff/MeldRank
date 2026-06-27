import { describe, expect, it } from 'vitest';
import { commit } from './commit';
import { toHex } from './encoding';

/** A deterministic 32-byte seed for tests (byte i = (base + i) mod 256). */
function seed(base: number): Uint8Array {
  return Uint8Array.from({ length: 32 }, (_unused, i) => (base + i) & 0xff);
}

describe('commit — server seed commitment binds before the deal', () => {
  it('is deterministic for a given seed', () => {
    expect(toHex(commit(seed(1)))).toBe(toHex(commit(seed(1))));
  });

  it('produces different commits for different seeds', () => {
    expect(toHex(commit(seed(1)))).not.toBe(toHex(commit(seed(2))));
  });

  it('produces a fixed-width 32-byte digest that does not expose the seed', () => {
    const serverSeed = seed(7);
    const digest = commit(serverSeed);
    expect(digest).toHaveLength(32);
    // The digest must not contain the seed bytes as a contiguous run.
    expect(toHex(digest).includes(toHex(serverSeed))).toBe(false);
  });

  it('does not mutate its input', () => {
    const serverSeed = seed(3);
    const before = Array.from(serverSeed);
    commit(serverSeed);
    expect(Array.from(serverSeed)).toEqual(before);
  });
});
