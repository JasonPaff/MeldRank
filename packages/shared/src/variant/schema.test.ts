import { describe, expect, it } from 'vitest';
import {
  VariantDefinitionSchema,
  widowEnabled,
  buryEnabled,
  passingEnabled,
  type VariantDefinition,
} from './schema';

/**
 * A fully specified, valid variant used as the baseline for accept/reject tests.
 * Deliberately distinct from the canonical fixtures so these tests exercise the
 * schema rather than the fixtures.
 */
function makeValidVariant(): unknown {
  return {
    id: 'test-variant',
    name: 'Test Variant',
    deck: { ranks: ['A', '10', 'K', 'Q', 'J', '9'], suits: ['spades', 'hearts', 'clubs', 'diamonds'], copiesPerCard: 2 },
    seating: { playerCount: 4, teams: { mode: 'partnerships', partnerships: [[0, 2], [1, 3]] } },
    dealing: {
      handSize: 12,
      widow: { size: 2, visibility: 'exposed' },
      bury: { size: 2, restrictions: ['no-trump'] },
    },
    passing: { count: 4, passBack: true },
    bidding: { minimumBid: 200, increment: 10, passBehavior: 'pass-out-for-hand', allPassRule: 'redeal' },
    trumpDeclaredBy: 'bid-winner',
    melding: { whoMelds: 'all-seats', meldTableId: 'standard-single-deck' },
    trick: {
      mustFollowSuit: true,
      mustTrumpWhenVoid: true,
      mustBeat: true,
      identicalCardTie: 'first-played-wins',
    },
    scoring: {
      counters: { A: 11, '10': 10, K: 4, Q: 3, J: 2, '9': 0 },
      lastTrickBonus: 10,
      meldNeedsATrick: true,
      mode: 'all-sides-score',
      setPenalty: 'minus-bid-and-meld-lost',
    },
    matchEnd: { mode: 'target-score', target: 1500 },
    ratingBasis: 'team-win-loss',
  };
}

describe('VariantDefinitionSchema', () => {
  it('parses a fully specified variant into a typed VariantDefinition', () => {
    const parsed = VariantDefinitionSchema.parse(makeValidVariant());
    expect(parsed.id).toBe('test-variant');
    expect(parsed.seating.playerCount).toBe(4);
    expect(parsed.matchEnd).toEqual({ mode: 'target-score', target: 1500 });
  });

  it('rejects an unknown enum value with a field-level issue', () => {
    const bad = makeValidVariant() as { ratingBasis: string };
    bad.ratingBasis = 'coin-flip';
    const result = VariantDefinitionSchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join('.') === 'ratingBasis')).toBe(true);
    }
  });

  it('rejects an out-of-range number with a field-level issue', () => {
    const bad = makeValidVariant() as { seating: { playerCount: number } };
    bad.seating.playerCount = 9;
    const result = VariantDefinitionSchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join('.') === 'seating.playerCount')).toBe(true);
    }
  });

  it('rejects a non-integer numeric axis', () => {
    const bad = makeValidVariant() as { bidding: { increment: number } };
    bad.bidding.increment = 10.5;
    const result = VariantDefinitionSchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join('.') === 'bidding.increment')).toBe(true);
    }
  });

  it('accepts zeroed widow/bury/passing and marks those phases disabled', () => {
    const input = makeValidVariant() as Record<string, unknown> & {
      dealing: { widow: { size: number }; bury: { size: number } };
      passing: { count: number };
    };
    input.dealing.widow.size = 0;
    input.dealing.bury.size = 0;
    input.passing.count = 0;

    const variant: VariantDefinition = VariantDefinitionSchema.parse(input);
    expect(widowEnabled(variant)).toBe(false);
    expect(buryEnabled(variant)).toBe(false);
    expect(passingEnabled(variant)).toBe(false);
  });

  it('marks bracketed phases enabled when their axis is non-zero', () => {
    const variant = VariantDefinitionSchema.parse(makeValidVariant());
    expect(widowEnabled(variant)).toBe(true);
    expect(buryEnabled(variant)).toBe(true);
    expect(passingEnabled(variant)).toBe(true);
  });
});
