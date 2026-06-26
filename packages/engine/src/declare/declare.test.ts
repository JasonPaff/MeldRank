import { describe, expect, it } from 'vitest';
import { SINGLE_DECK_PARTNERS, type VariantDefinition } from '@meldrank/shared';
import { reduce, createInitialState, getContract, type Event, type State } from '../index';
import { makeBid } from '../domain/entities';
import { declareTrump } from './declare';

/** Fold an ordered event log over `reduce` from a fresh initial state. */
function fold(variant: VariantDefinition, dealerSeat: number, log: readonly Event[]): State {
  return log.reduce((state, event) => reduce(state, event), createInitialState(variant, dealerSeat));
}

/** A Partners auction won by seat 2 (dealer 0), resting at DeclareTrump. */
const partnersWon: Event[] = [
  { type: 'deal', seed: 2024 },
  { type: 'bid', seat: 1, value: 250 },
  { type: 'bid', seat: 2, value: 260 },
  { type: 'pass', seat: 3 },
  { type: 'pass', seat: 0 },
  { type: 'pass', seat: 1 },
];

describe('declareTrump (pure)', () => {
  const suits = SINGLE_DECK_PARTNERS.deck.suits;

  it('accepts the contract winner naming a real suit', () => {
    expect(declareTrump(makeBid(2, 260), suits, 2, 'spades')).toEqual({
      status: 'declared',
      trump: 'spades',
    });
  });

  it('rejects a non-winner seat', () => {
    expect(declareTrump(makeBid(2, 260), suits, 1, 'spades')).toEqual({ status: 'rejected' });
  });

  it('rejects an unknown suit', () => {
    expect(declareTrump(makeBid(2, 260), suits, 2, 'swords' as never)).toEqual({
      status: 'rejected',
    });
  });

  it('rejects when no contract has been recorded', () => {
    expect(declareTrump(null, suits, 2, 'spades')).toEqual({ status: 'rejected' });
  });
});

describe('reduce — DeclareTrump phase', () => {
  it('records trump, melds at every seat, and passes through Melding to TrickPlay', () => {
    const final = reduce(fold(SINGLE_DECK_PARTNERS, 0, partnersWon), {
      type: 'declareTrump',
      seat: 2,
      trump: 'hearts',
    });

    expect(final.public.trump).toBe('hearts');
    // Partners has no Bury, so Melding passes through to TrickPlay (design D3).
    expect(final.public.phase).toBe('TrickPlay');
    expect(getContract(final)).toEqual({ seatIndex: 2, value: 260, trump: 'hearts' });
    // All four seats meld (whoMelds: all-seats).
    expect(final.public.melds.map((seatMeld) => seatMeld.seatIndex)).toEqual([0, 1, 2, 3]);
  });

  it('rejects a declaration from a non-winning seat with state unchanged', () => {
    const won = fold(SINGLE_DECK_PARTNERS, 0, partnersWon);
    const after = reduce(won, { type: 'declareTrump', seat: 1, trump: 'hearts' });
    expect(after).toBe(won);
  });

  it('rejects an unknown trump suit with state unchanged', () => {
    const won = fold(SINGLE_DECK_PARTNERS, 0, partnersWon);
    const after = reduce(won, { type: 'declareTrump', seat: 2, trump: 'swords' as never });
    expect(after).toBe(won);
  });

  it('rejects declareTrump outside its phase (during Auction) with state unchanged', () => {
    const dealt = fold(SINGLE_DECK_PARTNERS, 0, [{ type: 'deal', seed: 7 }]);
    const after = reduce(dealt, { type: 'declareTrump', seat: 1, trump: 'spades' });
    expect(after).toBe(dealt);
  });

  it('rejects a playCard in the wired slice (DeclareTrump frontier)', () => {
    const won = fold(SINGLE_DECK_PARTNERS, 0, partnersWon);
    const after = reduce(won, {
      type: 'playCard',
      seat: 2,
      card: { rank: 'A', suit: 'spades', copyIndex: 0 },
    });
    expect(after).toBe(won);
  });

  it('rejects a playCard after Melding too (the new TrickPlay frontier)', () => {
    const atTrickPlay = reduce(fold(SINGLE_DECK_PARTNERS, 0, partnersWon), {
      type: 'declareTrump',
      seat: 2,
      trump: 'hearts',
    });
    expect(atTrickPlay.public.phase).toBe('TrickPlay');
    const after = reduce(atTrickPlay, {
      type: 'playCard',
      seat: 2,
      card: { rank: 'A', suit: 'spades', copyIndex: 0 },
    });
    expect(after).toBe(atTrickPlay);
  });

  it('leaves trump null and the contract incomplete before declaration', () => {
    const won = fold(SINGLE_DECK_PARTNERS, 0, partnersWon);
    expect(won.public.trump).toBeNull();
    expect(getContract(won)).toBeNull();
  });
});
