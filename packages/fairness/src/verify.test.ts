import { describe, expect, it } from 'vitest';
import { deal } from '@meldrank/engine';
import { SINGLE_DECK_CUTTHROAT, SINGLE_DECK_PARTNERS } from '@meldrank/shared';
import { assembleSeed, type SeatContribution } from './assemble';
import { buildRevealBundle } from './build';
import { type RevealBundle } from './bundle';
import { rngFromSeed } from './rng';
import { type DealSpec, verify } from './verify';

function seed(base: number): Uint8Array {
  return Uint8Array.from({ length: 32 }, (_unused, i) => (base + i) & 0xff);
}

const PARTNERS_SPEC: DealSpec = { deckSpec: SINGLE_DECK_PARTNERS.deck, handSize: 12, widowSize: 0 };
const CUTTHROAT_SPEC: DealSpec = { deckSpec: SINGLE_DECK_CUTTHROAT.deck, handSize: 15, widowSize: 3 };

/** Run the full honest flow and return the reveal bundle for a played hand. */
function honestBundle(
  serverSeed: Uint8Array,
  handNonce: number,
  contributions: SeatContribution[],
  seatCount: number,
  spec: DealSpec,
): RevealBundle {
  const seedBytes = assembleSeed(serverSeed, handNonce, contributions, seatCount);
  const result = deal(spec.deckSpec, spec.handSize, spec.widowSize, rngFromSeed(seedBytes));
  return buildRevealBundle({ handNonce, serverSeed, contributions, seatCount, result });
}

const FOUR: SeatContribution[] = [
  { seat: 0, clientSeed: seed(10) },
  { seat: 1, clientSeed: seed(20) },
  { seat: 2, clientSeed: seed(30) },
  { seat: 3, clientSeed: seed(40) },
];

describe('verify — honest bundles', () => {
  it('verifies an honest deal', () => {
    const bundle = honestBundle(seed(100), 0, FOUR, 4, PARTNERS_SPEC);
    expect(verify(bundle, PARTNERS_SPEC)).toEqual({ ok: true });
  });

  it('verifies an honest deal with a substituted (absent) seat', () => {
    const present = [FOUR[0]!, FOUR[2]!]; // seats 1 and 3 absent
    const bundle = honestBundle(seed(101), 3, present, 4, PARTNERS_SPEC);
    // The bundle marks the absent seats and still verifies.
    expect(bundle.contributions.filter((c) => c.substituted).map((c) => c.seat)).toEqual([1, 3]);
    expect(verify(bundle, PARTNERS_SPEC)).toEqual({ ok: true });
  });

  it('verifies a three-seat cutthroat deal with a widow', () => {
    const three = [FOUR[0]!, FOUR[1]!, FOUR[2]!];
    const bundle = honestBundle(seed(55), 1, three, 3, CUTTHROAT_SPEC);
    expect(verify(bundle, CUTTHROAT_SPEC)).toEqual({ ok: true });
  });
});

describe('verify — replay sufficiency', () => {
  it('reproduces the deal from only the bundle and the public deal spec', () => {
    const bundle = honestBundle(seed(7), 2, FOUR, 4, PARTNERS_SPEC);
    // Round-trip the bundle through JSON to prove no live object state leaks in.
    const transported = JSON.parse(JSON.stringify(bundle)) as RevealBundle;
    expect(verify(transported, PARTNERS_SPEC)).toEqual({ ok: true });
  });
});

describe('verify — tamper rejection', () => {
  it('rejects a bundle whose serverSeed was altered (commit no longer binds)', () => {
    const bundle = honestBundle(seed(100), 0, FOUR, 4, PARTNERS_SPEC);
    const tampered: RevealBundle = { ...bundle, serverSeed: flipFirstHexNibble(bundle.serverSeed) };
    expect(verify(tampered, PARTNERS_SPEC)).toEqual({ ok: false, reason: 'commit-mismatch' });
  });

  it('rejects a bundle whose dealt-result digest does not match the replayed deal', () => {
    const bundle = honestBundle(seed(100), 0, FOUR, 4, PARTNERS_SPEC);
    const tampered: RevealBundle = { ...bundle, dealtResultDigest: flipFirstHexNibble(bundle.dealtResultDigest) };
    expect(verify(tampered, PARTNERS_SPEC)).toEqual({ ok: false, reason: 'result-digest-mismatch' });
  });

  it('rejects a bundle whose clientSeed was altered (deal no longer reproduces)', () => {
    const bundle = honestBundle(seed(100), 0, FOUR, 4, PARTNERS_SPEC);
    const contributions = bundle.contributions.map((c) =>
      c.seat === 1 && !c.substituted ? { ...c, clientSeed: flipFirstHexNibble(c.clientSeed) } : c,
    );
    const tampered: RevealBundle = { ...bundle, contributions };
    expect(verify(tampered, PARTNERS_SPEC)).toEqual({ ok: false, reason: 'result-digest-mismatch' });
  });

  it('rejects a structurally malformed bundle', () => {
    const bundle = honestBundle(seed(100), 0, FOUR, 4, PARTNERS_SPEC);
    const malformed: RevealBundle = { ...bundle, serverSeed: 'not-hex' };
    expect(verify(malformed, PARTNERS_SPEC)).toEqual({ ok: false, reason: 'malformed-bundle' });
  });
});

/** Flip the first hex nibble of a hex string, producing a different value of the same width. */
function flipFirstHexNibble(hex: string): string {
  const first = hex[0]!;
  const flipped = first === '0' ? '1' : '0';
  return flipped + hex.slice(1);
}
