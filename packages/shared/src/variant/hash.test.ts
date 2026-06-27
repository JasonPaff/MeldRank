import { describe, expect, it } from 'vitest';
import { canonicalJson, hashVariant } from './hash';
import { SINGLE_DECK_CUTTHROAT, SINGLE_DECK_PARTNERS } from './canonical';

describe('variant hash (design D4)', () => {
  it('is a 64-char lower-case hex SHA-256 digest', () => {
    expect(hashVariant(SINGLE_DECK_PARTNERS)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable across calls for the same variant', () => {
    expect(hashVariant(SINGLE_DECK_PARTNERS)).toBe(hashVariant(SINGLE_DECK_PARTNERS));
  });

  it('distinguishes the two canonical variants', () => {
    expect(hashVariant(SINGLE_DECK_PARTNERS)).not.toBe(hashVariant(SINGLE_DECK_CUTTHROAT));
  });

  it('is independent of object key insertion order', () => {
    // Rebuild the same variant with its top-level keys in a shuffled order.
    const shuffled = Object.fromEntries(
      Object.entries(SINGLE_DECK_PARTNERS as Record<string, unknown>).reverse(),
    ) as typeof SINGLE_DECK_PARTNERS;
    expect(hashVariant(shuffled)).toBe(hashVariant(SINGLE_DECK_PARTNERS));
  });

  it('changes when any content axis changes', () => {
    const retargeted = { ...SINGLE_DECK_PARTNERS, matchEnd: { mode: 'target-score' as const, target: 1000 } };
    expect(hashVariant(retargeted)).not.toBe(hashVariant(SINGLE_DECK_PARTNERS));
  });

  it('sorts object keys at every depth and preserves array order', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
  });
});
