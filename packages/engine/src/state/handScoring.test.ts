import { describe, expect, it } from 'vitest';
import { SINGLE_DECK_PARTNERS, type Rank, type Suit } from '@meldrank/shared';
import { reduce } from './reduce';
import { createInitialState, type SeatMeld, type State } from './state';
import { makeCard, type Card } from '../domain/card';
import { makeHand, makeTrick } from '../domain/entities';
import type { Event } from './events';

/**
 * The `HandScoring` pass-through wiring (design D6). When `TrickPlay` empties the
 * hands, `reduce` advances along the legal edge to `HandScoring`, deterministically
 * computes the `HandScorer` result, records it as `public.handResult`, appends its
 * per-side lines to `public.scorePad`, and rests there. The oracle is "Single-Deck
 * Partners" §8.
 */

function card(rank: Rank, suit: Suit, copyIndex = 0): Card {
  return makeCard(rank, suit, copyIndex);
}

function play(seat: number, c: Card): Event {
  return { type: 'playCard', seat, card: { rank: c.rank, suit: c.suit, copyIndex: c.copyIndex } };
}

/**
 * Build a state resting at `TrickPlay` with controlled hands, trump, contract, and
 * recorded melds — seeded as `reduce` seeds it on entry (contract seat leads, empty
 * trick, zeroed capture tally).
 */
function trickPlayState(
  hands: readonly (readonly Card[])[],
  trump: Suit,
  leader: number,
  melds: readonly SeatMeld[],
  contractValue: number,
): State {
  const base = createInitialState(SINGLE_DECK_PARTNERS, 0);
  const handObjs = hands.map((cards, seatIndex) => makeHand(seatIndex, cards));
  return {
    ...base,
    public: {
      ...base.public,
      phase: 'TrickPlay',
      trump,
      contract: { seatIndex: leader, value: contractValue },
      seatToAct: leader,
      currentTrick: makeTrick(),
      captured: handObjs.map((hand) => ({
        seatIndex: hand.seatIndex,
        counters: 0,
        tricksTaken: 0,
      })),
      melds,
    },
    private: { ...base.private, hands: handObjs },
  };
}

const seatMeld = (seatIndex: number, total: number): SeatMeld => ({ seatIndex, melds: [], total });

function foldPlays(state: State, plays: readonly Event[]): State {
  return plays.reduce((s, event) => reduce(s, event), state);
}

// Two-trick hands where each side takes one trick. Trump hearts; seat 0 leads.
// Trick 1: seat 0 wins with A♠ (counters 20). Trick 2: seat 0 leads 9♣, seat 1
// trumps with A♥ and wins (counters 21 + last-trick bonus 10 = 31).
const SPLIT_HANDS = [
  [card('A', 'spades'), card('9', 'clubs')], // seat 0 (side 0)
  [card('K', 'spades'), card('A', 'hearts')], // seat 1 (side 1) — trump
  [card('Q', 'spades'), card('9', 'spades')], // seat 2 (side 0)
  [card('J', 'spades'), card('10', 'clubs')], // seat 3 (side 1)
] as const;

const SPLIT_PLAYS: Event[] = [
  // Trick 1 — seat 0 wins.
  play(0, card('A', 'spades')),
  play(1, card('K', 'spades')),
  play(2, card('Q', 'spades')),
  play(3, card('J', 'spades')),
  // Trick 2 — seat 0 leads 9♣; seat 1 trumps to win.
  play(0, card('9', 'clubs')),
  play(1, card('A', 'hearts')),
  play(2, card('9', 'spades')),
  play(3, card('10', 'clubs')),
];

describe('HandScoring — pass-through wiring', () => {
  it('records a hand result and appends to the score pad on entering HandScoring', () => {
    // Bidding side 0 makes 250 on meld 230 + counters 20; side 1 scores 40 + 31.
    const melds = [seatMeld(0, 230), seatMeld(1, 40)];
    const final = foldPlays(trickPlayState(SPLIT_HANDS, 'hearts', 0, melds, 250), SPLIT_PLAYS);

    expect(final.public.phase).toBe('HandScoring');
    expect(final.public.handResult).not.toBeNull();
    expect(final.public.scorePad.hands).toHaveLength(1);
    expect(final.public.scorePad.hands[0]).toEqual(final.public.handResult!.lines);
  });

  it('scores both sides on a made Partners hand', () => {
    const melds = [seatMeld(0, 230), seatMeld(1, 40)];
    const final = foldPlays(trickPlayState(SPLIT_HANDS, 'hearts', 0, melds, 250), SPLIT_PLAYS);

    const result = final.public.handResult!;
    expect(result.made).toBe(true);
    expect(result.side).toBe(0);
    expect(result.lines).toEqual([
      { side: 0, meld: 230, counters: 20, total: 250 },
      { side: 1, meld: 40, counters: 31, total: 71 },
    ]);
    expect(final.public.scorePad.cumulative).toEqual({ 0: 250, 1: 71 });
  });

  it('records −bid with meld lost on a set bidding side, leaving opponents unaffected', () => {
    // Bidding side 0 falls short: meld 100 + counters 20 = 120 < 250 → set.
    const melds = [seatMeld(0, 100), seatMeld(1, 40)];
    const final = foldPlays(trickPlayState(SPLIT_HANDS, 'hearts', 0, melds, 250), SPLIT_PLAYS);

    const result = final.public.handResult!;
    expect(result.made).toBe(false);
    expect(result.lines).toEqual([
      { side: 0, meld: 0, counters: 0, total: -250 }, // minus-bid-and-meld-lost
      { side: 1, meld: 40, counters: 31, total: 71 }, // opponent unaffected
    ]);
    expect(final.public.scorePad.cumulative).toEqual({ 0: -250, 1: 71 });
  });

  it('forfeits a trickless side’s meld via the meld-needs-a-trick gate', () => {
    // One trick: seat 0 (side 0) wins everything; side 1 takes no trick. Side 1's
    // recorded 40 meld is voided; the bidding side still makes on meld + counters.
    const oneCardHands = [[card('A', 'spades')], [card('K', 'spades')], [card('Q', 'spades')], [card('J', 'spades')]];
    const melds = [seatMeld(0, 230), seatMeld(1, 40)];
    const final = foldPlays(trickPlayState(oneCardHands, 'hearts', 0, melds, 250), [
      play(0, card('A', 'spades')),
      play(1, card('K', 'spades')),
      play(2, card('Q', 'spades')),
      play(3, card('J', 'spades')),
    ]);

    const result = final.public.handResult!;
    // Side 0 counters: 20 + last-trick bonus 10 = 30; meld 230 → made.
    expect(result.lines).toEqual([
      { side: 0, meld: 230, counters: 30, total: 260 },
      { side: 1, meld: 0, counters: 0, total: 0 }, // meld forfeited (no trick)
    ]);
  });

  it('rests at HandScoring below the target and starts the next hand on a deal', () => {
    const melds = [seatMeld(0, 230), seatMeld(1, 40)];
    const scored = foldPlays(trickPlayState(SPLIT_HANDS, 'hearts', 0, melds, 250), SPLIT_PLAYS);

    // 250 < 1500 target → the match continues and rests at HandScoring.
    expect(scored.public.phase).toBe('HandScoring');
    expect(scored.public.matchResult).toBeNull();
    // A `deal` starts the next hand (the match-loop branch); a non-deal is rejected.
    expect(reduce(scored, play(0, card('A', 'spades')))).toBe(scored);
    const next = reduce(scored, { type: 'deal', seed: 1 });
    expect(next.public.phase).toBe('Auction');
    expect(next.public.scorePad.hands).toHaveLength(1); // score pad carried forward
  });
});
