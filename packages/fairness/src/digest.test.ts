import { describe, expect, it } from 'vitest';
import { deal } from '@meldrank/engine';
import { SINGLE_DECK_PARTNERS } from '@meldrank/shared';
import { dealtResultDigest } from './digest';
import { toHex } from './encoding';
import { rngFromSeed } from './rng';

function seed(base: number): Uint8Array {
  return Uint8Array.from({ length: 32 }, (_unused, i) => (base + i) & 0xff);
}

function dealFor(base: number) {
  return deal(SINGLE_DECK_PARTNERS.deck, 12, 0, rngFromSeed(seed(base)));
}

describe('dealtResultDigest — canonical digest of the dealt result', () => {
  it('is a deterministic 32-byte digest', () => {
    const result = dealFor(1);
    expect(dealtResultDigest(result)).toHaveLength(32);
    expect(toHex(dealtResultDigest(result))).toBe(toHex(dealtResultDigest(dealFor(1))));
  });

  it('differs for different deals', () => {
    expect(toHex(dealtResultDigest(dealFor(1)))).not.toBe(toHex(dealtResultDigest(dealFor(2))));
  });

  it('does not mutate the result', () => {
    const result = dealFor(3);
    const snapshot = JSON.stringify(result);
    dealtResultDigest(result);
    expect(JSON.stringify(result)).toBe(snapshot);
  });
});
