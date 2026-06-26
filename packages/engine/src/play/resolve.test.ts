import { describe, expect, it } from 'vitest';
import type { CounterValues, Rank, Suit } from '@meldrank/shared';
import { TrickResolver, capturedCounters } from './resolve';
import { makeCard, type Card } from '../domain/card';
import { makeTrick, type Trick, type TrickPlay } from '../domain/entities';

/**
 * Exhaustive TrickResolver coverage. The oracle is "Single-Deck Partners" §7:
 * highest trump wins; with no trump the highest of the led suit wins; off-led-suit
 * non-trumps cannot win; identical winning cards resolve to the one played first.
 * The captured-counter total sums the per-rank values over the trick's cards.
 */

const COUNTERS: CounterValues = { A: 11, '10': 10, K: 4, Q: 3, J: 2, '9': 0 };

function card(rank: Rank, suit: Suit, copyIndex = 0): Card {
  return makeCard(rank, suit, copyIndex);
}

/** A completed trick led by the first play's suit. */
function trick(plays: readonly TrickPlay[]): Trick {
  return makeTrick(plays[0]!.card.suit, plays, null);
}

describe('TrickResolver — winner selection', () => {
  it('awards the trick to the highest trump played', () => {
    const t = trick([
      { seatIndex: 0, card: card('A', 'spades') }, // led, non-trump
      { seatIndex: 1, card: card('9', 'hearts') }, // low trump
      { seatIndex: 2, card: card('K', 'hearts') }, // higher trump — wins
      { seatIndex: 3, card: card('10', 'spades') },
    ]);
    expect(TrickResolver(t, 'hearts')).toBe(2);
  });

  it('awards the trick to the highest card of the led suit when no trump is played', () => {
    const t = trick([
      { seatIndex: 0, card: card('K', 'spades') }, // led
      { seatIndex: 1, card: card('A', 'spades') }, // highest led suit — wins
      { seatIndex: 2, card: card('A', 'clubs') }, // off-suit, cannot win
      { seatIndex: 3, card: card('10', 'spades') },
    ]);
    expect(TrickResolver(t, 'hearts')).toBe(1);
  });

  it('never awards the trick to an off-led-suit non-trump, even an Ace', () => {
    const t = trick([
      { seatIndex: 0, card: card('9', 'spades') }, // led — the only led-suit card
      { seatIndex: 1, card: card('A', 'clubs') }, // off-suit Ace, cannot win
      { seatIndex: 2, card: card('A', 'diamonds') }, // off-suit Ace, cannot win
      { seatIndex: 3, card: card('10', 'clubs') }, // off-suit, cannot win
    ]);
    expect(TrickResolver(t, 'hearts')).toBe(0);
  });
});

describe('TrickResolver — identical-card tie', () => {
  it('resolves two identical winning cards to the one played first', () => {
    const t = trick([
      { seatIndex: 0, card: card('A', 'spades', 0) }, // led A♠, copy 0 — played first
      { seatIndex: 1, card: card('A', 'spades', 1) }, // identical A♠, copy 1
      { seatIndex: 2, card: card('K', 'spades') },
      { seatIndex: 3, card: card('Q', 'spades') },
    ]);
    expect(TrickResolver(t, 'hearts')).toBe(0);
  });

  it('resolves two identical winning trumps to the one played first', () => {
    const t = trick([
      { seatIndex: 0, card: card('K', 'spades') }, // led non-trump
      { seatIndex: 1, card: card('A', 'hearts', 1) }, // trump A♥, copy 1 — played first
      { seatIndex: 2, card: card('A', 'hearts', 0) }, // identical trump A♥, copy 0
      { seatIndex: 3, card: card('10', 'spades') },
    ]);
    expect(TrickResolver(t, 'hearts')).toBe(1);
  });
});

describe('capturedCounters', () => {
  it('totals the per-rank counter values over the trick (A, 10, and two 9s = 21)', () => {
    const t = trick([
      { seatIndex: 0, card: card('A', 'spades') }, // 11
      { seatIndex: 1, card: card('10', 'spades') }, // 10
      { seatIndex: 2, card: card('9', 'spades') }, // 0
      { seatIndex: 3, card: card('9', 'clubs') }, // 0
    ]);
    expect(capturedCounters(t, COUNTERS)).toBe(21);
  });

  it('totals zero for a counter-less (all-9s) trick', () => {
    const t = trick([
      { seatIndex: 0, card: card('9', 'spades') },
      { seatIndex: 1, card: card('9', 'hearts') },
      { seatIndex: 2, card: card('9', 'clubs') },
      { seatIndex: 3, card: card('9', 'diamonds') },
    ]);
    expect(capturedCounters(t, COUNTERS)).toBe(0);
  });
});

describe('TrickResolver — purity', () => {
  it('does not mutate the trick', () => {
    const t = trick([
      { seatIndex: 0, card: card('A', 'spades') },
      { seatIndex: 1, card: card('K', 'hearts') },
      { seatIndex: 2, card: card('Q', 'spades') },
      { seatIndex: 3, card: card('J', 'spades') },
    ]);
    const snapshot = structuredClone(t);
    TrickResolver(t, 'hearts');
    capturedCounters(t, COUNTERS);
    expect(t).toEqual(snapshot);
  });
});
