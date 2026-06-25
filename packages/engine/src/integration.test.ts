import { describe, expect, it } from 'vitest';
import { SINGLE_DECK_PARTNERS, SINGLE_DECK_CUTTHROAT, type VariantDefinition } from '@meldrank/shared';
import { reduce, createInitialState, type Event } from './index';

/** Fold an ordered event log over `reduce` from a fresh initial state. */
function fold(variant: VariantDefinition, dealerSeat: number, log: readonly Event[]) {
  return log.reduce((state, event) => reduce(state, event), createInitialState(variant, dealerSeat));
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

  it('advances a concluded Cutthroat auction to WidowReveal (bracketed phase enabled)', () => {
    const log: Event[] = [
      { type: 'deal', seed: 99 },
      { type: 'bid', seat: 1, value: 300 },
      { type: 'pass', seat: 2 },
      { type: 'pass', seat: 0 },
    ];
    const final = fold(SINGLE_DECK_CUTTHROAT, 0, log);

    expect(final.public.contract).toEqual({ seatIndex: 1, value: 300 });
    expect(final.public.phase).toBe('WidowReveal');
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
    const log: Event[] = [
      { type: 'deal', seed: 31415 },
      { type: 'bid', seat: 1, value: 250 },
      { type: 'pass', seat: 2 },
      { type: 'pass', seat: 3 },
      { type: 'pass', seat: 0 },
    ];

    expect(fold(SINGLE_DECK_PARTNERS, 0, log)).toEqual(fold(SINGLE_DECK_PARTNERS, 0, log));
  });
});
