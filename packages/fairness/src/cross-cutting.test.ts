import { describe, expect, it } from 'vitest';
import { deal } from '@meldrank/engine';
import { SINGLE_DECK_PARTNERS } from '@meldrank/shared';
import { assembleSeed, type SeatContribution } from './assemble';
import { buildRevealBundle } from './build';
import { commit } from './commit';
import { toHex } from './encoding';
import { rngFromSeed } from './rng';
import { type DealSpec, verify } from './verify';

function seed(base: number): Uint8Array {
  return Uint8Array.from({ length: 32 }, (_unused, i) => (base + i) & 0xff);
}

const SPEC: DealSpec = { deckSpec: SINGLE_DECK_PARTNERS.deck, handSize: 12, widowSize: 0 };

describe('isomorphic, pure, side-effect-free core', () => {
  it('produces results that depend only on byte content, not array identity', () => {
    // Two structurally-identical inputs built independently must yield identical
    // outputs — the property that lets the browser, the service, and bots agree.
    const serverA = seed(1);
    const serverB = Uint8Array.from(serverA); // distinct object, same bytes
    const contributionsA: SeatContribution[] = [{ seat: 0, clientSeed: seed(2) }, { seat: 1, clientSeed: seed(3) }];
    const contributionsB: SeatContribution[] = [
      { seat: 0, clientSeed: Uint8Array.from(seed(2)) },
      { seat: 1, clientSeed: Uint8Array.from(seed(3)) },
    ];
    expect(toHex(commit(serverA))).toBe(toHex(commit(serverB)));
    expect(toHex(assembleSeed(serverA, 0, contributionsA, 2))).toBe(toHex(assembleSeed(serverB, 0, contributionsB, 2)));
  });

  it('leaves every input unmutated across the full pipeline', () => {
    const serverSeed = seed(100);
    const contributions: SeatContribution[] = [
      { seat: 0, clientSeed: seed(10) },
      { seat: 1, clientSeed: seed(20) },
    ];
    const serverBefore = Array.from(serverSeed);
    const contribBefore = contributions.map((c) => Array.from(c.clientSeed));

    const seedBytes = assembleSeed(serverSeed, 0, contributions, 2);
    const result = deal(SPEC.deckSpec, SPEC.handSize, SPEC.widowSize, rngFromSeed(seedBytes));
    const bundle = buildRevealBundle({ handNonce: 0, serverSeed, contributions, seatCount: 2, result });
    verify(bundle, SPEC);

    expect(Array.from(serverSeed)).toEqual(serverBefore);
    expect(contributions.map((c) => Array.from(c.clientSeed))).toEqual(contribBefore);
  });

  it('runs without any environment-specific crypto global present', () => {
    // The core relies on @noble/hashes (pure JS) and TextEncoder only — never
    // crypto.subtle (browser) or node:crypto. Removing the crypto global must not
    // break it. Seed *generation* (getRandomValues) is the caller's job, not this
    // module's, so the pure functions stay available.
    const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    const canStub = original === undefined || original.configurable === true;
    try {
      if (canStub) {
        Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
      }
      const serverSeed = seed(5);
      const seedBytes = assembleSeed(serverSeed, 0, [{ seat: 0, clientSeed: seed(6) }], 1);
      const result = deal(SPEC.deckSpec, SPEC.handSize, SPEC.widowSize, rngFromSeed(seedBytes));
      const bundle = buildRevealBundle({ handNonce: 0, serverSeed, contributions: [{ seat: 0, clientSeed: seed(6) }], seatCount: 1, result });
      expect(verify(bundle, SPEC)).toEqual({ ok: true });
    } finally {
      if (canStub) {
        if (original) {
          Object.defineProperty(globalThis, 'crypto', original);
        } else {
          delete (globalThis as { crypto?: unknown }).crypto;
        }
      }
    }
  });
});

describe('uniform contribution interface for all participants', () => {
  it('treats identical seeds identically regardless of which participant produced them', () => {
    // A contribution is just { seat, clientSeed } — there is no participant-type
    // field to branch on. A "bot" seat and a "human" seat carrying the same bytes
    // are indistinguishable to the assembler.
    const humanContribution: SeatContribution = { seat: 1, clientSeed: seed(77) };
    const botContribution: SeatContribution = { seat: 1, clientSeed: seed(77) };
    const base: SeatContribution = { seat: 0, clientSeed: seed(10) };

    const withHuman = assembleSeed(seed(1), 0, [base, humanContribution], 2);
    const withBot = assembleSeed(seed(1), 0, [base, botContribution], 2);
    expect(toHex(withHuman)).toBe(toHex(withBot));
  });
});
