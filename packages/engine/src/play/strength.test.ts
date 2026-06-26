import { describe, expect, it } from 'vitest';
import type { Rank, Suit } from '@meldrank/shared';
import { trickStrength } from './strength';
import { makeCard, type Card } from '../domain/card';

/**
 * The card-strength comparator (design D2). The oracle is the locked ranking
 * `A > 10 > K > Q > J > 9` read within a trick context: trump outranks any
 * non-trump, led-suit cards outrank off-suit discards, and an off-led-suit
 * non-trump can never win. "Correctness here *is* the product's integrity" (§5).
 */

function card(rank: Rank, suit: Suit, copyIndex = 0): Card {
  return makeCard(rank, suit, copyIndex);
}

const RANKS: readonly Rank[] = ['A', '10', 'K', 'Q', 'J', '9'];

describe('trickStrength — trump dominance', () => {
  it('ranks any trump above any non-trump, regardless of rank', () => {
    // The weakest trump (a trump 9) still beats the strongest led-suit card (an A).
    const trump9 = trickStrength(card('9', 'hearts'), 'hearts', 'spades');
    const ledAce = trickStrength(card('A', 'spades'), 'hearts', 'spades');
    expect(trump9).toBeGreaterThan(ledAce);
  });

  it('treats led trump as trump when trump is itself led', () => {
    // ledSuit === trump: the led cards are trumps, in the trump tier.
    const trumpK = trickStrength(card('K', 'hearts'), 'hearts', 'hearts');
    const offAce = trickStrength(card('A', 'spades'), 'hearts', 'hearts');
    expect(trumpK).toBeGreaterThan(offAce);
  });
});

describe('trickStrength — ordinal within a suit', () => {
  it('holds the A > 10 > K > Q > J > 9 order among led-suit cards', () => {
    const strengths = RANKS.map((rank) => trickStrength(card(rank, 'spades'), 'hearts', 'spades'));
    // Strictly descending in the locked order.
    for (let i = 1; i < strengths.length; i++) {
      expect(strengths[i - 1]!).toBeGreaterThan(strengths[i]!);
    }
  });

  it('holds the same order among trumps', () => {
    const strengths = RANKS.map((rank) => trickStrength(card(rank, 'hearts'), 'hearts', 'spades'));
    for (let i = 1; i < strengths.length; i++) {
      expect(strengths[i - 1]!).toBeGreaterThan(strengths[i]!);
    }
  });

  it('gives the two copies of one card equal strength (the tie the resolver breaks by order)', () => {
    expect(trickStrength(card('A', 'spades', 0), 'hearts', 'spades')).toBe(
      trickStrength(card('A', 'spades', 1), 'hearts', 'spades'),
    );
  });
});

describe('trickStrength — off-led-suit non-trump cannot win', () => {
  it('ranks an off-led-suit non-trump below every trump and every led-suit card', () => {
    const offSuit = trickStrength(card('A', 'clubs'), 'hearts', 'spades');
    const weakestLed = trickStrength(card('9', 'spades'), 'hearts', 'spades');
    const weakestTrump = trickStrength(card('9', 'hearts'), 'hearts', 'spades');
    expect(offSuit).toBeLessThan(weakestLed);
    expect(offSuit).toBeLessThan(weakestTrump);
  });
});
