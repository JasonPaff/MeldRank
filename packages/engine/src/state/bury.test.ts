import { describe, expect, it } from 'vitest';
import { SINGLE_DECK_CUTTHROAT, type Rank, type Suit } from '@meldrank/shared';
import { reduce } from './reduce';
import { createInitialState, type SeatMeld, type State } from './state';
import { makeCard, type Card } from '../domain/card';
import { makeHand, makeMeld, makeTrick } from '../domain/entities';
import type { Event } from './events';

/**
 * The `Bury` phase driver in `reduce` (design D2, D4, D5). A bury-enabled variant
 * (Cutthroat) rests at `Bury` with the bidder on the clock; a legal `bury` (exactly
 * `dealing.bury.size` distinct, held, eligible cards) discards those cards into
 * `private.buried` and advances to a seeded `TrickPlay`; an illegal bury is a no-op;
 * and the buried counters are credited to the bidder at `HandScoring`. The oracle is
 * "Single-Deck Cutthroat / Auction Pinochle" §6 / Ruling 5 and §9.
 */

function card(rank: Rank, suit: Suit, copyIndex = 0): Card {
  return makeCard(rank, suit, copyIndex);
}

function bury(seat: number, cards: readonly Card[]): Event {
  return {
    type: 'bury',
    seat,
    cards: cards.map((c) => ({ rank: c.rank, suit: c.suit, copyIndex: c.copyIndex })),
  };
}

// A controlled Cutthroat bury fixture. Bidder (seat 0) holds three free cards plus
// a melded card, a trump card, and the trump dix; trump is spades. Only the three
// free cards are buryable.
const TRUMP: Suit = 'spades';
const FREE = [card('10', 'clubs'), card('Q', 'diamonds'), card('K', 'diamonds')] as const;
const MELDED = card('K', 'hearts');
const TRUMP_CARD = card('A', 'spades');
const DIX = card('9', 'spades');
const BIDDER_HAND = [...FREE, MELDED, TRUMP_CARD, DIX];

/** Build a Cutthroat state resting at `Bury` with the bidder (seat 0) set to act. */
function buryState(): State {
  const base = createInitialState(SINGLE_DECK_CUTTHROAT, 0);
  const hands = [
    makeHand(0, BIDDER_HAND),
    makeHand(1, [card('9', 'clubs'), card('J', 'clubs')]),
    makeHand(2, [card('9', 'diamonds'), card('J', 'diamonds')]),
  ];
  const melds: SeatMeld[] = [{ seatIndex: 0, melds: [makeMeld('marriage', [MELDED], 0, 'A')], total: 0 }];
  return {
    ...base,
    public: {
      ...base.public,
      phase: 'Bury',
      trump: TRUMP,
      contract: { seatIndex: 0, value: 300 },
      seatToAct: 0,
      melds,
    },
    private: { ...base.private, hands },
  };
}

describe('reduce Bury — entry and a legal bury', () => {
  it('rests at Bury with the bidder set to act', () => {
    const state = buryState();
    expect(state.public.phase).toBe('Bury');
    expect(state.public.seatToAct).toBe(0);
  });

  it('accepts a legal bury: removes the cards, fills the buried pile, seeds TrickPlay', () => {
    const state = buryState();
    const next = reduce(state, bury(0, FREE));

    // The phase advanced to a seeded TrickPlay with the bidder leading.
    expect(next.public.phase).toBe('TrickPlay');
    expect(next.public.seatToAct).toBe(0);
    expect(next.public.currentTrick).toEqual(makeTrick());
    expect(next.public.captured).toEqual([
      { seatIndex: 0, counters: 0, tricksTaken: 0 },
      { seatIndex: 1, counters: 0, tricksTaken: 0 },
      { seatIndex: 2, counters: 0, tricksTaken: 0 },
    ]);

    // The three buried cards left the bidder's hand into the (private) bury pile.
    expect(next.private.buried).toEqual([...FREE]);
    expect(next.private.hands[0]!.cards).toEqual([MELDED, TRUMP_CARD, DIX]);
  });
});

describe('reduce Bury — illegal buries are no-ops', () => {
  it('rejects a wrong-sized bury (too few or too many)', () => {
    const state = buryState();
    expect(reduce(state, bury(0, FREE.slice(0, 2)))).toBe(state);
    expect(reduce(state, bury(0, [...FREE, MELDED]))).toBe(state); // 4 cards
  });

  it('rejects a bury repeating a card', () => {
    const state = buryState();
    expect(reduce(state, bury(0, [FREE[0], FREE[1], FREE[0]]))).toBe(state);
  });

  it('rejects a bury naming a card the bidder does not hold', () => {
    const state = buryState();
    const unheld = card('A', 'clubs');
    expect(reduce(state, bury(0, [FREE[0], FREE[1], unheld]))).toBe(state);
  });

  it('rejects a bury naming an ineligible card (melded, trump, or dix)', () => {
    const state = buryState();
    expect(reduce(state, bury(0, [FREE[0], FREE[1], MELDED]))).toBe(state);
    expect(reduce(state, bury(0, [FREE[0], FREE[1], TRUMP_CARD]))).toBe(state);
    expect(reduce(state, bury(0, [FREE[0], FREE[1], DIX]))).toBe(state);
  });

  it('rejects a bury from a seat other than the bidder', () => {
    const state = buryState();
    expect(reduce(state, bury(1, FREE))).toBe(state);
  });
});

describe('reduce Bury — a bury is rejected outside the Bury phase', () => {
  it('rejects a bury during Auction', () => {
    const dealt = reduce(createInitialState(SINGLE_DECK_CUTTHROAT, 0), { type: 'deal', seed: 7 });
    expect(dealt.public.phase).toBe('Auction');
    expect(reduce(dealt, bury(0, FREE))).toBe(dealt);
  });

  it('rejects a second bury once the phase has advanced to TrickPlay', () => {
    const afterBury = reduce(buryState(), bury(0, FREE));
    expect(afterBury.public.phase).toBe('TrickPlay');
    expect(reduce(afterBury, bury(0, []))).toBe(afterBury);
  });
});

/**
 * Build a one-trick Cutthroat state resting at `TrickPlay` (bidder seat 0 leads with
 * the trump ace and wins), with an injected `buried` pile, so folding the single
 * trick advances to a scored `HandScoring`.
 */
function oneTrickState(buried: readonly Card[], contractValue: number): State {
  const base = createInitialState(SINGLE_DECK_CUTTHROAT, 0);
  const hands = [
    makeHand(0, [card('A', 'spades')]), // bidder, trump → wins the trick
    makeHand(1, [card('9', 'clubs')]),
    makeHand(2, [card('J', 'clubs')]),
  ];
  return {
    ...base,
    public: {
      ...base.public,
      phase: 'TrickPlay',
      trump: TRUMP,
      contract: { seatIndex: 0, value: contractValue },
      seatToAct: 0,
      currentTrick: makeTrick(),
      captured: hands.map((h) => ({ seatIndex: h.seatIndex, counters: 0, tricksTaken: 0 })),
      melds: [{ seatIndex: 0, melds: [], total: 0 }],
    },
    private: { ...base.private, hands, buried },
  };
}

const ONE_TRICK_PLAYS: Event[] = [
  { type: 'playCard', seat: 0, card: { rank: 'A', suit: 'spades', copyIndex: 0 } },
  { type: 'playCard', seat: 1, card: { rank: '9', suit: 'clubs', copyIndex: 0 } },
  { type: 'playCard', seat: 2, card: { rank: 'J', suit: 'clubs', copyIndex: 0 } },
];

function foldPlays(state: State, plays: readonly Event[]): State {
  return plays.reduce((s, event) => reduce(s, event), state);
}

describe('reduce Bury — buried counters are credited at HandScoring', () => {
  it('adds the buried cards counter values to the bidding side', () => {
    // Captured this hand: A(11) + 9(0) + J(2) = 13, + last-trick bonus 10 = 23.
    const noBury = foldPlays(oneTrickState([], 20), ONE_TRICK_PLAYS);
    expect(noBury.public.phase).toBe('HandScoring');
    const bidderLine = (s: State) => s.public.handResult!.lines.find((l) => l.side === 0)!;
    expect(bidderLine(noBury).counters).toBe(23);

    // Bury two aces (11 + 11 = 22): the bidding side's counters climb by exactly 22.
    const buried = [card('A', 'clubs'), card('A', 'diamonds')];
    const withBury = foldPlays(oneTrickState(buried, 20), ONE_TRICK_PLAYS);
    expect(bidderLine(withBury).counters).toBe(23 + 22);
  });
});
