import { describe, expect, it } from 'vitest';
import { deal } from '@meldrank/engine';
import { SINGLE_DECK_CUTTHROAT } from '@meldrank/shared';
import { assembleSeed, fallbackContribution, type SeatContribution } from './assemble';
import { toHex } from './encoding';
import { rngFromSeed } from './rng';

function seed(base: number): Uint8Array {
  return Uint8Array.from({ length: 32 }, (_unused, i) => (base + i) & 0xff);
}

const SERVER = seed(100);

describe('fallbackContribution — missing-reveal substitution', () => {
  it('is deterministic for a given server seed and seat', () => {
    expect(toHex(fallbackContribution(SERVER, 2))).toBe(toHex(fallbackContribution(SERVER, 2)));
  });

  it('differs per seat', () => {
    expect(toHex(fallbackContribution(SERVER, 0))).not.toBe(toHex(fallbackContribution(SERVER, 1)));
  });

  it('is 32 bytes — the same width as a real clientSeed', () => {
    expect(fallbackContribution(SERVER, 0)).toHaveLength(32);
  });

  it('gives the server no new control after commit (fixed function of the committed seed)', () => {
    // Once serverSeed is committed, the substitute is fully determined: a
    // different (would-be) serverSeed yields a different substitute, so the
    // server cannot grind a favourable fill without breaking its own commit.
    expect(toHex(fallbackContribution(SERVER, 2))).not.toBe(toHex(fallbackContribution(seed(101), 2)));
  });
});

describe('a hand with a substituted seat still assembles and deals reproducibly', () => {
  const present: SeatContribution[] = [
    { seat: 0, clientSeed: seed(10) },
    { seat: 2, clientSeed: seed(30) },
  ];

  it('derives the same deal every time despite the gap (seat 1 absent)', () => {
    const seedA = assembleSeed(SERVER, 7, present, 3);
    const seedB = assembleSeed(SERVER, 7, present, 3);
    expect(toHex(seedA)).toBe(toHex(seedB));

    const first = deal(SINGLE_DECK_CUTTHROAT.deck, 15, 3, rngFromSeed(seedA));
    const second = deal(SINGLE_DECK_CUTTHROAT.deck, 15, 3, rngFromSeed(seedB));
    expect(second).toEqual(first);
    expect(first.hands).toHaveLength(3);
    expect(first.widow).toHaveLength(3);
  });

  it('matches an assembly where the absent seat is supplied as its explicit fallback', () => {
    const viaGap = assembleSeed(SERVER, 7, present, 3);
    const viaExplicit = assembleSeed(SERVER, 7, [...present, { seat: 1, clientSeed: fallbackContribution(SERVER, 1) }], 3);
    expect(toHex(viaGap)).toBe(toHex(viaExplicit));
  });
});
