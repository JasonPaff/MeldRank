import { describe, expect, it } from 'vitest';
import {
  SINGLE_DECK_PARTNERS,
  SINGLE_DECK_CUTTHROAT,
  type VariantDefinition,
} from '@meldrank/shared';
import { reduce, createInitialState, type Event } from './index';

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
