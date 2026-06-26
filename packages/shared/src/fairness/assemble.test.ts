import { describe, expect, it } from 'vitest';
import { assembleSeed, fallbackContribution, type SeatContribution } from './assemble';
import { toHex } from './encoding';

function seed(base: number): Uint8Array {
  return Uint8Array.from({ length: 32 }, (_unused, i) => (base + i) & 0xff);
}

function contribution(seat: number, base: number): SeatContribution {
  return { seat, clientSeed: seed(base) };
}

const SERVER = seed(100);
const FOUR = [contribution(0, 10), contribution(1, 20), contribution(2, 30), contribution(3, 40)];

describe('assembleSeed — multi-party seed assembly', () => {
  it('is deterministic for the same inputs', () => {
    expect(toHex(assembleSeed(SERVER, 0, FOUR, 4))).toBe(toHex(assembleSeed(SERVER, 0, FOUR, 4)));
  });

  it('changes when any single clientSeed changes', () => {
    const baseline = toHex(assembleSeed(SERVER, 0, FOUR, 4));
    const altered = [contribution(0, 10), contribution(1, 21), contribution(2, 30), contribution(3, 40)];
    expect(toHex(assembleSeed(SERVER, 0, altered, 4))).not.toBe(baseline);
  });

  it('changes when the serverSeed changes', () => {
    expect(toHex(assembleSeed(seed(101), 0, FOUR, 4))).not.toBe(toHex(assembleSeed(SERVER, 0, FOUR, 4)));
  });

  it('changes when the hand nonce changes', () => {
    expect(toHex(assembleSeed(SERVER, 1, FOUR, 4))).not.toBe(toHex(assembleSeed(SERVER, 0, FOUR, 4)));
  });

  it('is independent of contribution arrival order (encoded in fixed seat order)', () => {
    const shuffled = [contribution(2, 30), contribution(0, 10), contribution(3, 40), contribution(1, 20)];
    expect(toHex(assembleSeed(SERVER, 0, shuffled, 4))).toBe(toHex(assembleSeed(SERVER, 0, FOUR, 4)));
  });

  it('lets no single party drive the seed to a chosen target', () => {
    // Model the attack: a party fixes everyone else's contribution and tries to
    // steer the assembled seed to a value it *chose in advance* (here, all-zeros).
    // Sweeping its own contribution across many distinct seeds never lands on the
    // chosen target — doing so would require a SHA-256 preimage.
    const chosenTarget = '0'.repeat(64);
    const fixed = [contribution(0, 10), contribution(1, 20), contribution(2, 30)];
    for (let attempt = 0; attempt < 256; attempt++) {
      const withLast = [...fixed, contribution(3, 200 + attempt)];
      expect(toHex(assembleSeed(SERVER, 0, withLast, 4))).not.toBe(chosenTarget);
    }
  });

  it('rejects duplicate and out-of-range seats', () => {
    expect(() => assembleSeed(SERVER, 0, [contribution(0, 1), contribution(0, 2)], 4)).toThrow();
    expect(() => assembleSeed(SERVER, 0, [contribution(4, 1)], 4)).toThrow(RangeError);
    expect(() => assembleSeed(SERVER, 0, FOUR, 0)).toThrow(RangeError);
  });

  it('does not mutate its inputs', () => {
    const serverBefore = Array.from(SERVER);
    const firstBefore = Array.from(FOUR[0]!.clientSeed);
    assembleSeed(SERVER, 0, FOUR, 4);
    expect(Array.from(SERVER)).toEqual(serverBefore);
    expect(Array.from(FOUR[0]!.clientSeed)).toEqual(firstBefore);
  });
});

describe('assembleSeed — absent seats fall back deterministically', () => {
  it('fills an absent seat with its committed-derived substitute', () => {
    // Assembling with seat 3 absent must equal assembling with seat 3 explicitly
    // set to its fallback contribution.
    const withGap = [contribution(0, 10), contribution(1, 20), contribution(2, 30)];
    const withExplicitFallback = [...withGap, { seat: 3, clientSeed: fallbackContribution(SERVER, 3) }];
    expect(toHex(assembleSeed(SERVER, 0, withGap, 4))).toBe(toHex(assembleSeed(SERVER, 0, withExplicitFallback, 4)));
  });
});
