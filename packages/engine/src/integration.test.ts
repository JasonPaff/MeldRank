import { describe, expect, it } from 'vitest';
import {
  SINGLE_DECK_PARTNERS,
  SINGLE_DECK_CUTTHROAT,
  type VariantDefinition,
} from '@meldrank/shared';
import { reduce, createInitialState, LegalPlayValidator, type Event, type State } from './index';

/** Fold an ordered event log over `reduce` from a fresh initial state. */
function fold(variant: VariantDefinition, dealerSeat: number, log: readonly Event[]) {
  return log.reduce(
    (state, event) => reduce(state, event),
    createInitialState(variant, dealerSeat),
  );
}

describe('Dealing → Auction integration', () => {
  it('deals into the Auction phase with populated hands and widow', () => {
    const dealt = fold(SINGLE_DECK_CUTTHROAT, 0, [{ type: 'deal', seed: 555 }]);

    expect(dealt.public.phase).toBe('Auction');
    expect(dealt.private.hands.map((hand) => hand.cards.length)).toEqual([15, 15, 15]);
    expect(dealt.private.widow).toHaveLength(3);
    expect(dealt.public.seatToAct).toBe(1);
  });

  it('folds a full Partners auction into a recorded winning bid at DeclareTrump', () => {
    const log: Event[] = [
      { type: 'deal', seed: 2024 },
      { type: 'bid', seat: 1, value: 250 },
      { type: 'bid', seat: 2, value: 260 },
      { type: 'pass', seat: 3 },
      { type: 'pass', seat: 0 },
      { type: 'pass', seat: 1 },
    ];
    const final = fold(SINGLE_DECK_PARTNERS, 0, log);

    expect(final.public.contract).toEqual({ seatIndex: 2, value: 260 });
    // Partners skips WidowReveal, so the auction advances straight to DeclareTrump.
    expect(final.public.phase).toBe('DeclareTrump');
    expect(final.public.outcome).toBeNull();
  });

  it('folds a Partners hand through Melding to recorded melds at every seat, resting at TrickPlay', () => {
    const log: Event[] = [
      { type: 'deal', seed: 2024 },
      { type: 'bid', seat: 1, value: 250 },
      { type: 'bid', seat: 2, value: 260 },
      { type: 'pass', seat: 3 },
      { type: 'pass', seat: 0 },
      { type: 'pass', seat: 1 },
      { type: 'declareTrump', seat: 2, trump: 'hearts' },
    ];
    const final = fold(SINGLE_DECK_PARTNERS, 0, log);

    expect(final.public.contract).toEqual({ seatIndex: 2, value: 260 });
    expect(final.public.trump).toBe('hearts');
    // Partners skips Bury, so Melding passes through to TrickPlay.
    expect(final.public.phase).toBe('TrickPlay');
    // All four seats meld; each entry carries a seat, its melds, and a numeric total.
    expect(final.public.melds.map((seatMeld) => seatMeld.seatIndex)).toEqual([0, 1, 2, 3]);
    for (const seatMeld of final.public.melds) {
      expect(typeof seatMeld.total).toBe('number');
      expect(seatMeld.total).toBe(seatMeld.melds.reduce((sum, meld) => sum + meld.value, 0));
    }
  });

  it('folds a Cutthroat hand through the widow reveal and Melding to a bidder-only meld at Bury', () => {
    const dealt = fold(SINGLE_DECK_CUTTHROAT, 0, [{ type: 'deal', seed: 99 }]);
    const log: Event[] = [
      { type: 'deal', seed: 99 },
      { type: 'bid', seat: 1, value: 300 },
      { type: 'pass', seat: 2 },
      { type: 'pass', seat: 0 },
      { type: 'declareTrump', seat: 1, trump: 'clubs' },
    ];
    const final = fold(SINGLE_DECK_CUTTHROAT, 0, log);

    expect(final.public.contract).toEqual({ seatIndex: 1, value: 300 });
    // The widow was revealed into the bidder's hand on the way to DeclareTrump.
    expect(final.public.revealedWidow).toEqual(dealt.private.widow);
    expect(final.private.hands[1]!.cards).toHaveLength(18);
    expect(final.private.widow).toEqual([]);
    expect(final.public.trump).toBe('clubs');
    // Cutthroat has a Bury, so Melding rests at Bury (not TrickPlay).
    expect(final.public.phase).toBe('Bury');
    // Only the bidder melds (whoMelds: bidder-only).
    expect(final.public.melds.map((seatMeld) => seatMeld.seatIndex)).toEqual([1]);
  });

  it('surfaces a redeal outcome on a Cutthroat all-pass without advancing the phase', () => {
    const log: Event[] = [
      { type: 'deal', seed: 1 },
      { type: 'pass', seat: 1 },
      { type: 'pass', seat: 2 },
    ];
    const final = fold(SINGLE_DECK_CUTTHROAT, 0, log);

    expect(final.public.outcome).toBe('redeal');
    expect(final.public.contract).toBeNull();
    expect(final.public.phase).toBe('Auction');
  });

  it('folds a full Partners hand through TrickPlay to HandScoring with a complete capture tally', () => {
    // Drive the auction + declaration to the resting TrickPlay phase.
    const setup: Event[] = [
      { type: 'deal', seed: 2024 },
      { type: 'bid', seat: 1, value: 250 },
      { type: 'bid', seat: 2, value: 260 },
      { type: 'pass', seat: 3 },
      { type: 'pass', seat: 0 },
      { type: 'pass', seat: 1 },
      { type: 'declareTrump', seat: 2, trump: 'hearts' },
    ];
    const postMelding = fold(SINGLE_DECK_PARTNERS, 0, setup);
    expect(postMelding.public.phase).toBe('TrickPlay');

    // Generate a legal play log: at each turn, the seat-to-act plays its first
    // legal card. This folds the whole hand to all-hands-empty.
    const playLog: Event[] = [];
    let state: State = postMelding;
    while (state.public.phase === 'TrickPlay') {
      const seat = state.public.seatToAct!;
      const hand = state.private.hands[seat]!;
      const legal = LegalPlayValidator(
        hand,
        state.public.currentTrick,
        state.public.trump!,
        SINGLE_DECK_PARTNERS.trick,
      );
      const card = legal[0]!;
      const event: Event = {
        type: 'playCard',
        seat,
        card: { rank: card.rank, suit: card.suit, copyIndex: card.copyIndex },
      };
      playLog.push(event);
      state = reduce(state, event);
    }

    // 4 seats × 12 cards = 48 plays over 12 tricks, then the phase advances.
    expect(playLog).toHaveLength(48);
    expect(state.public.phase).toBe('HandScoring');
    expect(state.public.seatToAct).toBeNull();
    expect(state.public.completedTricks).toHaveLength(12);
    expect(state.public.completedTricks.every((t) => t.winnerSeatIndex !== null)).toBe(true);
    expect(state.private.hands.every((h) => h.cards.length === 0)).toBe(true);
    // Every counter point (240) plus the last-trick bonus (10) is captured.
    const totalCounters = state.public.captured.reduce((sum, c) => sum + c.counters, 0);
    expect(totalCounters).toBe(250);
    const totalTricks = state.public.captured.reduce((sum, c) => sum + c.tricksTaken, 0);
    expect(totalTricks).toBe(12);

    // HandScoring computed the per-side result and appended it to the score pad.
    const result = state.public.handResult!;
    expect(result).not.toBeNull();
    // Partners folds the four seats into the two partnership sides.
    expect(result.lines.map((line) => line.side)).toEqual([0, 1]);
    // The bidding side is the contract seat's side (seat 2 → partnership [0, 2] = side 0).
    expect(result.side).toBe(0);
    expect(typeof result.made).toBe('boolean');
    // Each line's total is consistent: meld + counters, or the set penalty (−bid).
    for (const line of result.lines) {
      const expected = line.side === result.side && !result.made ? -260 : line.meld + line.counters;
      expect(line.total).toBe(expected);
    }
    // The pad carries exactly this hand's lines and its cumulative-by-side totals.
    expect(state.public.scorePad.hands).toHaveLength(1);
    expect(state.public.scorePad.hands[0]).toEqual(result.lines);
    for (const line of result.lines) {
      expect(state.public.scorePad.cumulative[line.side]).toBe(line.total);
    }

    // Folding the same play log twice from the same post-melding state is
    // deep-equal (replay determinism).
    const replayA = playLog.reduce((s, e) => reduce(s, e), postMelding);
    const replayB = playLog.reduce((s, e) => reduce(s, e), postMelding);
    expect(replayA).toEqual(replayB);
    expect(replayA).toEqual(state);
  });

  it('folds the same event log twice to deep-equal state (replay determinism)', () => {
    const partners: Event[] = [
      { type: 'deal', seed: 31415 },
      { type: 'bid', seat: 1, value: 250 },
      { type: 'pass', seat: 2 },
      { type: 'pass', seat: 3 },
      { type: 'pass', seat: 0 },
      { type: 'declareTrump', seat: 1, trump: 'spades' },
    ];
    expect(fold(SINGLE_DECK_PARTNERS, 0, partners)).toEqual(
      fold(SINGLE_DECK_PARTNERS, 0, partners),
    );

    // The Cutthroat fold runs through the deterministic widow reveal too.
    const cutthroat: Event[] = [
      { type: 'deal', seed: 27182 },
      { type: 'bid', seat: 1, value: 300 },
      { type: 'pass', seat: 2 },
      { type: 'pass', seat: 0 },
      { type: 'declareTrump', seat: 1, trump: 'diamonds' },
    ];
    expect(fold(SINGLE_DECK_CUTTHROAT, 0, cutthroat)).toEqual(
      fold(SINGLE_DECK_CUTTHROAT, 0, cutthroat),
    );
  });
});
