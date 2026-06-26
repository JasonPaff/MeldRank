import { describe, expect, it } from 'vitest';
import { SINGLE_DECK_PARTNERS, type Rank, type Suit } from '@meldrank/shared';
import { reduce } from './reduce';
import { createInitialState, type State } from './state';
import { makeCard, type Card } from '../domain/card';
import { makeHand, makeTrick } from '../domain/entities';
import type { Event } from './events';

/**
 * The `TrickPlay` loop wiring (design D5). The phase rests and folds repeated
 * `playCard` intents: the bid winner leads, each play is validated against the
 * `LegalPlayValidator` and the seat-to-act, and on a complete trick the winner is
 * credited its counters and leads next — looping until hands empty, then advancing
 * to `HandScoring`. The oracle is "Single-Deck Partners" §7.
 */

function card(rank: Rank, suit: Suit, copyIndex = 0): Card {
  return makeCard(rank, suit, copyIndex);
}

function play(seat: number, c: Card): Event {
  return { type: 'playCard', seat, card: { rank: c.rank, suit: c.suit, copyIndex: c.copyIndex } };
}

/**
 * Build a state resting at `TrickPlay` with controlled hands and trump, seeded as
 * `reduce` seeds it on entry: the contract seat leads, the current trick is empty,
 * and every dealt seat's capture tally starts at zero.
 */
function trickPlayState(hands: readonly (readonly Card[])[], trump: Suit, leader: number): State {
  const base = createInitialState(SINGLE_DECK_PARTNERS, 0);
  const handObjs = hands.map((cards, seatIndex) => makeHand(seatIndex, cards));
  return {
    ...base,
    public: {
      ...base.public,
      phase: 'TrickPlay',
      trump,
      contract: { seatIndex: leader, value: 250 },
      seatToAct: leader,
      currentTrick: makeTrick(),
      captured: handObjs.map((hand) => ({
        seatIndex: hand.seatIndex,
        counters: 0,
        tricksTaken: 0,
      })),
    },
    private: { ...base.private, hands: handObjs },
  };
}

/** Fold an ordered play log over `reduce` from a TrickPlay state. */
function foldPlays(state: State, plays: readonly Event[]): State {
  return plays.reduce((s, event) => reduce(s, event), state);
}

describe('TrickPlay — entry seeding (bid winner leads first)', () => {
  it('seeds the contract seat to lead an empty trick with a zeroed capture tally', () => {
    const log: Event[] = [
      { type: 'deal', seed: 2024 },
      { type: 'bid', seat: 1, value: 250 },
      { type: 'bid', seat: 2, value: 260 },
      { type: 'pass', seat: 3 },
      { type: 'pass', seat: 0 },
      { type: 'pass', seat: 1 },
      { type: 'declareTrump', seat: 2, trump: 'hearts' },
    ];
    const state = log.reduce((s, e) => reduce(s, e), createInitialState(SINGLE_DECK_PARTNERS, 0));

    expect(state.public.phase).toBe('TrickPlay');
    expect(state.public.seatToAct).toBe(2); // the bid winner
    expect(state.public.currentTrick.plays).toEqual([]);
    expect(state.public.completedTricks).toEqual([]);
    expect(state.public.captured.map((c) => c.seatIndex)).toEqual([0, 1, 2, 3]);
    expect(state.public.captured.every((c) => c.counters === 0 && c.tricksTaken === 0)).toBe(true);
  });
});

// Hands for a controlled two-trick playthrough. Trump is hearts, seat 0 leads.
// Seat 3 (void in spades, holds the only trumps) takes both tricks.
const HANDS = [
  [card('A', 'spades'), card('9', 'spades')], // seat 0
  [card('10', 'spades'), card('K', 'spades')], // seat 1
  [card('Q', 'spades'), card('J', 'spades')], // seat 2
  [card('9', 'hearts'), card('J', 'hearts')], // seat 3 — trumps
] as const;

describe('TrickPlay — accept / reject', () => {
  it('accepts a legal play from the seat-to-act, advancing the turn', () => {
    const state = trickPlayState(HANDS, 'hearts', 0);
    const next = reduce(state, play(0, card('A', 'spades')));

    expect(next.public.currentTrick.ledSuit).toBe('spades');
    expect(next.public.currentTrick.plays).toHaveLength(1);
    expect(next.public.seatToAct).toBe(1);
    expect(next.private.hands[0]!.cards).toEqual([card('9', 'spades')]);
  });

  it('rejects an out-of-turn play, leaving the state unchanged', () => {
    const state = trickPlayState(HANDS, 'hearts', 0);
    expect(reduce(state, play(1, card('10', 'spades')))).toBe(state);
  });

  it('rejects a card the seat does not hold', () => {
    const state = trickPlayState(HANDS, 'hearts', 0);
    expect(reduce(state, play(0, card('A', 'clubs')))).toBe(state);
  });

  it('rejects an illegal play (a discard while the led suit is held)', () => {
    // Seat 1 holds a heart but also spades; it must follow spades.
    const hands = [[card('A', 'spades')], [card('K', 'spades'), card('A', 'hearts')], [card('Q', 'spades')], [card('J', 'spades')]];
    const state = trickPlayState(hands, 'hearts', 0);
    const led = reduce(state, play(0, card('A', 'spades')));
    expect(reduce(led, play(1, card('A', 'hearts')))).toBe(led); // off-suit discard rejected
    expect(reduce(led, play(1, card('K', 'spades'))).public.seatToAct).toBe(2); // following accepted
  });
});

describe('TrickPlay — trick resolution and the loop', () => {
  it('credits the winner, has it lead the next trick, and rests at TrickPlay mid-hand', () => {
    const state = trickPlayState(HANDS, 'hearts', 0);
    const afterTrick1 = foldPlays(state, [
      play(0, card('A', 'spades')),
      play(1, card('10', 'spades')),
      play(2, card('Q', 'spades')),
      play(3, card('9', 'hearts')), // the only trump — seat 3 wins
    ]);

    expect(afterTrick1.public.phase).toBe('TrickPlay'); // still resting (cards remain)
    expect(afterTrick1.public.seatToAct).toBe(3); // the winner leads next
    expect(afterTrick1.public.currentTrick.plays).toEqual([]); // fresh trick
    expect(afterTrick1.public.completedTricks).toHaveLength(1);
    expect(afterTrick1.public.completedTricks[0]!.winnerSeatIndex).toBe(3);
    // Captured counters: A=11, 10=10, Q=3, 9♥=0 → 24, no bonus yet.
    const seat3 = afterTrick1.public.captured.find((c) => c.seatIndex === 3)!;
    expect(seat3.counters).toBe(24);
    expect(seat3.tricksTaken).toBe(1);
  });

  it('awards the last-trick bonus and advances to HandScoring when hands empty', () => {
    const state = trickPlayState(HANDS, 'hearts', 0);
    const final = foldPlays(state, [
      // Trick 1 — seat 3 wins with 9♥.
      play(0, card('A', 'spades')),
      play(1, card('10', 'spades')),
      play(2, card('Q', 'spades')),
      play(3, card('9', 'hearts')),
      // Trick 2 — seat 3 leads J♥ (trump); the rest must discard.
      play(3, card('J', 'hearts')),
      play(0, card('9', 'spades')),
      play(1, card('K', 'spades')),
      play(2, card('J', 'spades')),
    ]);

    expect(final.public.phase).toBe('HandScoring');
    expect(final.public.seatToAct).toBeNull();
    expect(final.public.completedTricks).toHaveLength(2);
    expect(final.public.currentTrick.plays).toEqual([]);
    // Seat 3 took both tricks: 24 (trick 1) + J♥2 + K♠4 + J♠2 = 8, +10 bonus = 18 → 42.
    const seat3 = final.public.captured.find((c) => c.seatIndex === 3)!;
    expect(seat3.counters).toBe(42);
    expect(seat3.tricksTaken).toBe(2);
    // Every counter point in the hand (240 → here 32) plus the bonus is captured.
    const totalCaptured = final.public.captured.reduce((sum, c) => sum + c.counters, 0);
    expect(totalCaptured).toBe(42);
  });

  it('rejects a playCard after the hand has advanced to HandScoring', () => {
    const state = trickPlayState([[card('A', 'spades')], [card('K', 'spades')], [card('Q', 'spades')], [card('J', 'spades')]], 'hearts', 0);
    const done = foldPlays(state, [
      play(0, card('A', 'spades')),
      play(1, card('K', 'spades')),
      play(2, card('Q', 'spades')),
      play(3, card('J', 'spades')),
    ]);
    expect(done.public.phase).toBe('HandScoring');
    // A late playCard is rejected by the guard, unchanged.
    expect(reduce(done, play(0, card('A', 'spades')))).toBe(done);
  });
});
