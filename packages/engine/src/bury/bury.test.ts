import { describe, expect, it } from 'vitest';
import type { BuryRestriction, Rank, Suit } from '@meldrank/shared';
import { buryableCards } from './bury';
import { makeCard, cardsIdentical, type Card } from '../domain/card';
import { makeHand, makeMeld, type Meld } from '../domain/entities';

/**
 * Bury-validator coverage, per "Single-Deck Cutthroat / Auction Pinochle" §6 /
 * Ruling 5 (design D2). The oracle: a card is buryable only if it violates **no**
 * active restriction — `no-melded` (by identity), `no-trump`, `no-dix`. The
 * canonical Cutthroat set carries all three.
 */

const ALL: readonly BuryRestriction[] = ['no-melded', 'no-trump', 'no-dix'];

function card(rank: Rank, suit: Suit, copyIndex = 0): Card {
  return makeCard(rank, suit, copyIndex);
}

/** A one-card class-A meld over `cards` (only its `cards` matter to the validator). */
function meld(...cards: Card[]): Meld {
  return makeMeld('test', cards, 0, 'A');
}

/** Order-insensitive membership by identity. */
function includesCard(set: readonly Card[], c: Card): boolean {
  return set.some((card) => cardsIdentical(card, c));
}

describe('buryableCards — restrictions', () => {
  it('excludes melded cards, trump cards, and the trump dix; includes the rest', () => {
    const trump: Suit = 'spades';
    const meldedKing = card('K', 'hearts');
    const trumpAce = card('A', 'spades');
    const trumpDix = card('9', 'spades');
    const free10 = card('10', 'clubs');
    const freeQueen = card('Q', 'diamonds');
    const hand = makeHand(0, [meldedKing, trumpAce, trumpDix, free10, freeQueen]);

    const result = buryableCards(hand, [meld(meldedKing)], trump, ALL);

    // Every restricted card is excluded.
    expect(includesCard(result, meldedKing)).toBe(false); // no-melded
    expect(includesCard(result, trumpAce)).toBe(false); // no-trump
    expect(includesCard(result, trumpDix)).toBe(false); // no-trump + no-dix
    // The unrestricted cards remain.
    expect(includesCard(result, free10)).toBe(true);
    expect(includesCard(result, freeQueen)).toBe(true);
    expect(result).toHaveLength(2);
  });

  it('keeps an unused copy of a melded value buryable (excludes by identity)', () => {
    const usedQueen = card('Q', 'hearts', 0);
    const unusedQueen = card('Q', 'hearts', 1);
    const hand = makeHand(0, [usedQueen, unusedQueen]);

    // Only copy 0 is in the meld; trump is clubs so neither is trump.
    const result = buryableCards(hand, [meld(usedQueen)], 'clubs', ['no-melded']);

    expect(includesCard(result, usedQueen)).toBe(false);
    expect(includesCard(result, unusedQueen)).toBe(true);
    expect(result).toHaveLength(1);
  });

  it('applies no-dix independently of no-trump', () => {
    const trumpDix = card('9', 'spades');
    const trumpAce = card('A', 'spades');
    const hand = makeHand(0, [trumpDix, trumpAce]);

    // Only no-dix active: the trump 9 is excluded, but the trump ace is buryable.
    const result = buryableCards(hand, [], 'spades', ['no-dix']);

    expect(includesCard(result, trumpDix)).toBe(false);
    expect(includesCard(result, trumpAce)).toBe(true);
    expect(result).toHaveLength(1);
  });

  it('returns the whole hand when no restrictions are active', () => {
    const hand = makeHand(0, [card('A', 'spades'), card('9', 'spades'), card('K', 'hearts')]);
    const result = buryableCards(hand, [meld(card('K', 'hearts'))], 'spades', []);
    expect(result).toHaveLength(3);
  });
});

describe('buryableCards — determinism and non-mutation', () => {
  it('is deterministic and does not mutate its inputs', () => {
    const trump: Suit = 'hearts';
    const cards = [card('A', 'hearts'), card('K', 'clubs'), card('Q', 'diamonds')];
    const hand = makeHand(0, cards);
    const melds = [meld(card('Q', 'diamonds'))];

    const handSnapshot = JSON.parse(JSON.stringify(hand));
    const meldsSnapshot = JSON.parse(JSON.stringify(melds));

    const first = buryableCards(hand, melds, trump, ALL);
    const second = buryableCards(hand, melds, trump, ALL);

    expect(first).toEqual(second);
    expect(hand).toEqual(handSnapshot);
    expect(melds).toEqual(meldsSnapshot);
  });
});
