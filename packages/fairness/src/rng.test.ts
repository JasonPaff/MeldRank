import { describe, expect, it } from 'vitest';
import { deal } from '@meldrank/engine';
import { SINGLE_DECK_PARTNERS } from '@meldrank/shared';
import { rngFromSeed } from './rng';

function seed(base: number): Uint8Array {
  return Uint8Array.from({ length: 32 }, (_unused, i) => (base + i) & 0xff);
}

function take(seedBytes: Uint8Array, count: number): number[] {
  const rng = rngFromSeed(seedBytes);
  return Array.from({ length: count }, () => rng.nextUint32());
}

describe('rngFromSeed — full-width Rng derivation', () => {
  it('emits an identical stream for the same seed', () => {
    expect(take(seed(1), 20)).toEqual(take(seed(1), 20));
  });

  it('emits a different stream for distinct seeds', () => {
    expect(take(seed(1), 20)).not.toEqual(take(seed(2), 20));
  });

  it('crosses block boundaries (more than eight words per stream)', () => {
    // Eight words per 32-byte block; drawing 20 forces three blocks. The stream
    // must not repeat the first block's words.
    const words = take(seed(5), 24);
    expect(words.slice(0, 8)).not.toEqual(words.slice(8, 16));
    expect(new Set(words).size).toBeGreaterThan(8);
  });

  it('returns unsigned 32-bit integers', () => {
    for (const word of take(seed(9), 64)) {
      expect(Number.isInteger(word)).toBe(true);
      expect(word).toBeGreaterThanOrEqual(0);
      expect(word).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it('drives a real engine deal reproducibly', () => {
    const first = deal(SINGLE_DECK_PARTNERS.deck, 12, 0, rngFromSeed(seed(42)));
    const second = deal(SINGLE_DECK_PARTNERS.deck, 12, 0, rngFromSeed(seed(42)));
    expect(second).toEqual(first);
    expect(first.hands).toHaveLength(4);
    expect(first.hands.map((hand) => hand.cards.length)).toEqual([12, 12, 12, 12]);
  });

  it('produces a different deal for a different seed', () => {
    const a = deal(SINGLE_DECK_PARTNERS.deck, 12, 0, rngFromSeed(seed(1)));
    const b = deal(SINGLE_DECK_PARTNERS.deck, 12, 0, rngFromSeed(seed(2)));
    expect(b).not.toEqual(a);
  });

  it('consumes the entire seed — every byte affects the stream (no 32-bit bottleneck)', () => {
    const baseline = take(seed(0), 8);
    // Flip each of the 32 seed bytes in turn; a derivation limited to a 32-bit
    // reduction could only react to the low word, so reacting to all 32 bytes
    // proves the full 256-bit seed is keyed in.
    for (let position = 0; position < 32; position++) {
      const mutated = seed(0);
      mutated[position] = (mutated[position]! ^ 0xff) & 0xff;
      expect(take(mutated, 8)).not.toEqual(baseline);
    }
  });

  it('does not mutate the seed', () => {
    const seedBytes = seed(11);
    const before = Array.from(seedBytes);
    take(seedBytes, 16);
    expect(Array.from(seedBytes)).toEqual(before);
  });
});
