import { describe, expect, it } from 'vitest';
import { SINGLE_DECK_PARTNERS, type Rank, type Suit } from '@meldrank/shared';
import { reduce } from './reduce';
import { createInitialState, type State } from './state';
import { makeCard, type Card } from '../domain/card';
import { makeHand, makeTrick } from '../domain/entities';
import type { Event } from './events';

/**
 * Centralized `timeout` resolution in `reduce` (design D4). A `timeout` for the
 * seat-to-act is resolved by `TimeoutMove` and applied through the identical
 * intent path a human move takes; a `timeout` for any other seat, or in a phase
 * with no forced move, is a no-op. The oracle is the `hand-state-container`
 * "Phase-guarded event application" requirement.
 */

function card(rank: Rank, suit: Suit, copyIndex = 0): Card {
  return makeCard(rank, suit, copyIndex);
}

function play(seat: number, c: Card): Event {
  return { type: 'playCard', seat, card: { rank: c.rank, suit: c.suit, copyIndex: c.copyIndex } };
}

/** A `TrickPlay` state seeded as `reduce` seeds it: leader to act, empty trick, zeroed tally. */
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

const HANDS = [
  [card('A', 'spades'), card('9', 'clubs')], // seat 0 — leader
  [card('10', 'spades'), card('K', 'spades')], // seat 1
  [card('Q', 'spades'), card('J', 'spades')], // seat 2
  [card('9', 'hearts'), card('J', 'hearts')], // seat 3
] as const;

describe('reduce — a timeout for the seat-to-act applies the forced move', () => {
  it('during Auction, a timeout passes the seat (identical to a pass intent)', () => {
    const dealt = reduce(createInitialState(SINGLE_DECK_PARTNERS), { type: 'deal', seed: 7 });
    expect(dealt.public.seatToAct).toBe(1);

    const viaTimeout = reduce(dealt, { type: 'timeout', seat: 1 });
    const viaPass = reduce(dealt, { type: 'pass', seat: 1 });

    expect(viaTimeout).toEqual(viaPass);
    expect(viaTimeout.public.auction?.live[1]).toBe(false);
    expect(viaTimeout.public.seatToAct).toBe(2);
  });

  it('during TrickPlay, a timeout plays the forced lowest-value legal card', () => {
    const state = trickPlayState(HANDS, 'hearts', 0);
    // Seat 0 leads; the weakest rank is the 9♣ (rank value, not trump strength).
    const viaTimeout = reduce(state, { type: 'timeout', seat: 0 });
    const viaPlay = reduce(state, play(0, card('9', 'clubs')));

    expect(viaTimeout).toEqual(viaPlay);
    expect(viaTimeout.public.currentTrick.plays).toHaveLength(1);
    expect(viaTimeout.public.currentTrick.plays[0]!.card).toEqual(card('9', 'clubs'));
    expect(viaTimeout.public.seatToAct).toBe(1);
    expect(viaTimeout.private.hands[0]!.cards).toEqual([card('A', 'spades')]);
  });
});

describe('reduce — a timeout that resolves to no forced move is a no-op', () => {
  it('a timeout for a non-acting seat leaves the state unchanged', () => {
    const state = trickPlayState(HANDS, 'hearts', 0);
    expect(reduce(state, { type: 'timeout', seat: 2 })).toBe(state);

    const dealt = reduce(createInitialState(SINGLE_DECK_PARTNERS), { type: 'deal', seed: 7 });
    expect(reduce(dealt, { type: 'timeout', seat: 0 })).toBe(dealt); // seat 1 is to act
  });

  it('a timeout during DeclareTrump is a no-op (no forced declaration)', () => {
    const base = createInitialState(SINGLE_DECK_PARTNERS, 0);
    // Construct a DeclareTrump state with a seat explicitly on the clock: even
    // then, TimeoutMove defines no move, so reduce leaves the state unchanged.
    const declaring: State = {
      ...base,
      public: {
        ...base.public,
        phase: 'DeclareTrump',
        seatToAct: 2,
        contract: { seatIndex: 2, value: 250 },
      },
    };
    expect(reduce(declaring, { type: 'timeout', seat: 2 })).toBe(declaring);
  });
});

describe('reduce — deterministic replay over a log with timeout events', () => {
  it('folding the same log twice yields deep-equal state', () => {
    const init = createInitialState(SINGLE_DECK_PARTNERS, 0);
    const log: Event[] = [
      { type: 'deal', seed: 4242 },
      { type: 'timeout', seat: 1 }, // forced pass
      { type: 'bid', seat: 2, value: 250 },
      { type: 'timeout', seat: 3 }, // forced pass
      { type: 'timeout', seat: 0 }, // forced pass — seat 2 wins
    ];
    const first = log.reduce((s, e) => reduce(s, e), init);
    const second = log.reduce((s, e) => reduce(s, e), init);
    expect(first).toEqual(second);
  });

  it('folding a TrickPlay log with a timeout twice yields deep-equal state', () => {
    const start = trickPlayState(HANDS, 'hearts', 0);
    const log: Event[] = [
      { type: 'timeout', seat: 0 }, // forces 9♣
      play(1, card('10', 'spades')),
      play(2, card('Q', 'spades')),
      play(3, card('9', 'hearts')),
    ];
    const first = log.reduce((s, e) => reduce(s, e), start);
    const second = log.reduce((s, e) => reduce(s, e), start);
    expect(first).toEqual(second);
    expect(first.public.completedTricks).toHaveLength(1);
  });
});
