import { describe, expect, it } from 'vitest';
import type { Rank, Suit, TrickRules } from '@meldrank/shared';
import { LegalPlayValidator } from './legal';
import { makeCard, cardsIdentical, type Card } from '../domain/card';
import { makeHand, makeTrick, type Trick, type TrickPlay } from '../domain/entities';

/**
 * Exhaustive LegalPlayValidator coverage. The oracle is "Single-Deck Partners"
 * §7: follow suit if able, else trump if able, else play anything — with strict
 * must-beat (must-head in-suit, over-trump on trump) layered on each able branch.
 * Each obligation is gated on its `trickRules` flag, so relaxing a flag widens the
 * set. "Correctness here *is* the product's integrity" (§5).
 */

const STRICT: TrickRules = {
  mustFollowSuit: true,
  mustTrumpWhenVoid: true,
  mustBeat: true,
  identicalCardTie: 'first-played-wins',
};

function card(rank: Rank, suit: Suit, copyIndex = 0): Card {
  return makeCard(rank, suit, copyIndex);
}

function play(seatIndex: number, c: Card): TrickPlay {
  return { seatIndex, card: c };
}

/** A trick led by `plays[0]`'s suit. */
function trick(plays: readonly TrickPlay[]): Trick {
  return makeTrick(plays.length > 0 ? plays[0]!.card.suit : null, plays, null);
}

/** Run the validator over a loose set of cards (seat 0). */
function legal(cards: readonly Card[], t: Trick, trump: Suit, rules: TrickRules = STRICT): Card[] {
  return LegalPlayValidator(makeHand(0, cards), t, trump, rules);
}

/** Order-insensitive set membership by identity. */
function has(set: readonly Card[], c: Card): boolean {
  return set.some((member) => cardsIdentical(member, c));
}

describe('LegalPlayValidator — the leader', () => {
  it('may play any card into an empty trick', () => {
    const hand = [card('A', 'spades'), card('9', 'hearts'), card('K', 'clubs')];
    const set = legal(hand, makeTrick(), 'hearts');
    expect(set).toEqual(hand);
  });
});

describe('LegalPlayValidator — follow suit', () => {
  it('restricts to led-suit cards when the seat holds the led suit', () => {
    const hand = [card('K', 'spades'), card('A', 'hearts'), card('Q', 'clubs')];
    // Led spades by an unbeatable card so must-head does not further restrict.
    const t = trick([play(1, card('A', 'spades'))]);
    const set = legal(hand, t, 'hearts');
    expect(set).toEqual([card('K', 'spades')]);
  });

  it('excludes trump and off-suit cards while the led suit is held', () => {
    const hand = [card('9', 'spades'), card('A', 'hearts')];
    const t = trick([play(1, card('A', 'spades'))]);
    const set = legal(hand, t, 'hearts');
    expect(has(set, card('A', 'hearts'))).toBe(false);
  });
});

describe('LegalPlayValidator — must trump when void', () => {
  it('restricts to trump when void in the led suit and holding trump', () => {
    const hand = [card('9', 'hearts'), card('K', 'hearts'), card('A', 'clubs')];
    const t = trick([play(1, card('A', 'spades'))]);
    const set = legal(hand, t, 'hearts');
    expect(set).toEqual([card('9', 'hearts'), card('K', 'hearts')]);
  });

  it('allows a free discard when void in the led suit and holding no trump', () => {
    const hand = [card('A', 'clubs'), card('9', 'diamonds')];
    const t = trick([play(1, card('A', 'spades'))]);
    const set = legal(hand, t, 'hearts');
    expect(set).toEqual(hand);
  });
});

describe('LegalPlayValidator — strict must-head (in-suit)', () => {
  it('restricts to led-suit cards that beat the current winner when able', () => {
    const hand = [card('A', 'spades'), card('9', 'spades')];
    // Current winner is K♠; only A♠ beats it.
    const t = trick([play(1, card('K', 'spades'))]);
    const set = legal(hand, t, 'hearts');
    expect(set).toEqual([card('A', 'spades')]);
  });

  it('leaves all led-suit cards legal when none can beat the winner', () => {
    const hand = [card('K', 'spades'), card('9', 'spades')];
    // Current winner is A♠; neither led-suit card beats it.
    const t = trick([play(1, card('A', 'spades'))]);
    const set = legal(hand, t, 'hearts');
    expect(set).toEqual(hand);
  });
});

describe('LegalPlayValidator — strict over-trump', () => {
  it('restricts to trumps that beat the winning trump when the trick is already trumped', () => {
    const hand = [card('A', 'hearts'), card('9', 'hearts'), card('A', 'clubs')];
    // Led spades, then seat 2 trumped with K♥; seat is void in spades.
    const t = trick([play(1, card('A', 'spades')), play(2, card('K', 'hearts'))]);
    const set = legal(hand, t, 'hearts');
    // Only A♥ beats the K♥ trump; 9♥ does not.
    expect(set).toEqual([card('A', 'hearts')]);
  });

  it('leaves all trumps legal when none can over-trump', () => {
    const hand = [card('Q', 'hearts'), card('9', 'hearts')];
    const t = trick([play(1, card('A', 'spades')), play(2, card('K', 'hearts'))]);
    const set = legal(hand, t, 'hearts');
    expect(set).toEqual(hand);
  });

  it('does not force over-trump when the current winner is a non-trump (any trump beats it)', () => {
    const hand = [card('Q', 'hearts'), card('9', 'hearts')];
    // Led spades, no one has trumped yet — winner is the led A♠.
    const t = trick([play(1, card('A', 'spades'))]);
    const set = legal(hand, t, 'hearts');
    expect(set).toEqual(hand);
  });
});

describe('LegalPlayValidator — relaxed flags widen the set', () => {
  it('does not restrict to the led suit when mustFollowSuit is off', () => {
    const hand = [card('K', 'spades'), card('A', 'hearts')];
    const t = trick([play(1, card('A', 'spades'))]);
    const set = legal(hand, t, 'hearts', { ...STRICT, mustFollowSuit: false });
    expect(set).toEqual(hand);
  });

  it('does not force a beating card when mustBeat is off', () => {
    const hand = [card('A', 'spades'), card('9', 'spades')];
    const t = trick([play(1, card('K', 'spades'))]);
    const set = legal(hand, t, 'hearts', { ...STRICT, mustBeat: false });
    // Both led-suit cards legal — no must-head obligation.
    expect(set).toEqual(hand);
  });

  it('allows a discard over trump when mustTrumpWhenVoid is off', () => {
    const hand = [card('9', 'hearts'), card('A', 'clubs')];
    const t = trick([play(1, card('A', 'spades'))]);
    const set = legal(hand, t, 'hearts', { ...STRICT, mustTrumpWhenVoid: false });
    expect(set).toEqual(hand);
  });
});

describe('LegalPlayValidator — purity and non-emptiness', () => {
  it('never mutates its inputs and always returns a non-empty set for a non-empty hand', () => {
    const hand = [card('K', 'spades'), card('9', 'spades')];
    const t = trick([play(1, card('A', 'spades'))]);
    const snapshot = structuredClone(hand);
    const set = legal(hand, t, 'hearts');
    expect(hand).toEqual(snapshot);
    expect(set.length).toBeGreaterThan(0);
  });
});
