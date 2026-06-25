import { describe, expect, it } from 'vitest';
import { SINGLE_DECK_PARTNERS, SINGLE_DECK_CUTTHROAT } from '@meldrank/shared';
import { buildDeck } from '../domain/deck';
import { cardIdentityKey, type Card } from '../domain/card';
import { deal } from './deal';
import { createSeededRng } from './rng';

/** Multiset of card identity keys, for conservation / equality comparisons. */
function identityMultiset(cards: readonly Card[]): string[] {
  return cards.map(cardIdentityKey).sort();
}

describe('Dealer — deterministic seeded deal', () => {
  it('deals identically for the same deck spec and seed', () => {
    const first = deal(SINGLE_DECK_PARTNERS.deck, 12, 0, createSeededRng(12345));
    const second = deal(SINGLE_DECK_PARTNERS.deck, 12, 0, createSeededRng(12345));
    expect(second).toEqual(first);
  });

  it('deals differently for different seeds', () => {
    const a = deal(SINGLE_DECK_PARTNERS.deck, 12, 0, createSeededRng(1));
    const b = deal(SINGLE_DECK_PARTNERS.deck, 12, 0, createSeededRng(2));
    expect(b).not.toEqual(a);
  });
});

describe('Dealer — deal-size invariant', () => {
  it('deals four hands of twelve and an empty widow for Partners', () => {
    const { hands, widow } = deal(SINGLE_DECK_PARTNERS.deck, 12, 0, createSeededRng(7));
    expect(hands).toHaveLength(4);
    expect(hands.map((hand) => hand.cards.length)).toEqual([12, 12, 12, 12]);
    expect(hands.map((hand) => hand.seatIndex)).toEqual([0, 1, 2, 3]);
    expect(widow).toHaveLength(0);
  });

  it('deals three hands of fifteen and a three-card widow for Cutthroat', () => {
    const { hands, widow } = deal(SINGLE_DECK_CUTTHROAT.deck, 15, 3, createSeededRng(7));
    expect(hands).toHaveLength(3);
    expect(hands.map((hand) => hand.cards.length)).toEqual([15, 15, 15]);
    expect(widow).toHaveLength(3);
  });

  it('rejects a configuration whose sizes do not sum to the deck size', () => {
    // 48 cards, 12 per hand, widow 1 → 47 is not divisible into whole hands.
    expect(() => deal(SINGLE_DECK_PARTNERS.deck, 12, 1, createSeededRng(7))).toThrow();
  });
});

describe('Dealer — conservation of the deck', () => {
  it('reconstitutes the built deck exactly as a multiset of hands plus widow', () => {
    const { hands, widow } = deal(SINGLE_DECK_CUTTHROAT.deck, 15, 3, createSeededRng(99));
    const dealt = [...hands.flatMap((hand) => hand.cards), ...widow];
    const deck = buildDeck(SINGLE_DECK_CUTTHROAT.deck);
    expect(identityMultiset(dealt)).toEqual(identityMultiset(deck));
    expect(dealt).toHaveLength(deck.length);
  });
});
