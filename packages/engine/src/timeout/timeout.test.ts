import { describe, expect, it } from 'vitest';
import { SINGLE_DECK_PARTNERS, type Rank, type Suit } from '@meldrank/shared';
import { TimeoutMove } from './timeout';
import { LegalPlayValidator } from '../play';
import { createInitialState, type State } from '../state/state';
import { makeCard, type Card } from '../domain/card';
import { makeHand, makeTrick, type TrickPlay } from '../domain/entities';
import type { LifecyclePhase } from '../lifecycle/phases';

/**
 * `TimeoutMove` — the Ruling 5 forced-move policy (design D1–D3, D5). A pure
 * `(state) → PlayerIntent | null`: a `pass` where passing is legal (`Auction`),
 * the lowest-value legal card in `TrickPlay`, and `null` for every phase Ruling 5
 * leaves undefined (`DeclareTrump`, non-acting phases). The oracle is
 * "Game Engine — Abstract Model" §5 / Ruling 5.
 *
 * Deck suit order (the suit tiebreak): `spades, hearts, clubs, diamonds`.
 */

function card(rank: Rank, suit: Suit, copyIndex = 0): Card {
  return makeCard(rank, suit, copyIndex);
}

/** A state resting at `phase` with `seatToAct` set (no hands/trick needed). */
function phaseState(phase: LifecyclePhase, seatToAct: number | null): State {
  const base = createInitialState(SINGLE_DECK_PARTNERS, 0);
  return { ...base, public: { ...base.public, phase, seatToAct } };
}

/** A `TrickPlay` state with a controlled hand for the seat-to-act and trump. */
function trickState(
  seat: number,
  hand: readonly Card[],
  trump: Suit,
  plays: readonly TrickPlay[] = [],
): State {
  const base = createInitialState(SINGLE_DECK_PARTNERS, 0);
  const ledSuit = plays.length > 0 ? plays[0]!.card.suit : null;
  return {
    ...base,
    public: {
      ...base.public,
      phase: 'TrickPlay',
      trump,
      seatToAct: seat,
      currentTrick: makeTrick(ledSuit, plays, null),
    },
    private: { ...base.private, hands: [makeHand(seat, hand)] },
  };
}

describe('TimeoutMove — purity and the null cases (task 3.1)', () => {
  it('is pure and deterministic: deep-equal on repeat, input unmutated', () => {
    const state = trickState(0, [card('A', 'spades'), card('9', 'clubs')], 'hearts');
    const snapshot = structuredClone(state);

    const first = TimeoutMove(state);
    const second = TimeoutMove(state);

    expect(first).toEqual(second);
    expect(state).toEqual(snapshot); // input not mutated
  });

  it('returns null when no seat is to act (seatToAct === null)', () => {
    expect(TimeoutMove(phaseState('HandScoring', null))).toBeNull();
    expect(TimeoutMove(phaseState('MatchComplete', null))).toBeNull();
  });

  it('returns null during DeclareTrump (Ruling 5 invents no declaration)', () => {
    expect(TimeoutMove(phaseState('DeclareTrump', 2))).toBeNull();
  });
});

describe('TimeoutMove — the Auction arm (task 3.2)', () => {
  it('forces a pass for the seat to act', () => {
    expect(TimeoutMove(phaseState('Auction', 3))).toEqual({ type: 'pass', seat: 3 });
  });
});

describe('TimeoutMove — the TrickPlay arm (task 3.3)', () => {
  it('the leader plays the lowest-rank card (rank value, not trick strength)', () => {
    // Hand spans ranks; trump is hearts. The weakest rank is 9 (regardless of
    // trump), so the 9♣ is forced even though A♠ and Q♠ outrank it in a trick.
    const state = trickState(
      0,
      [card('A', 'spades'), card('Q', 'spades'), card('9', 'clubs')],
      'hearts',
    );
    expect(TimeoutMove(state)).toEqual({
      type: 'playCard',
      seat: 0,
      card: { rank: '9', suit: 'clubs', copyIndex: 0 },
    });
  });

  it('breaks an equal-rank tie by suit order (spades before hearts)', () => {
    const state = trickState(0, [card('9', 'hearts'), card('9', 'spades')], 'clubs');
    expect(TimeoutMove(state)).toEqual({
      type: 'playCard',
      seat: 0,
      card: { rank: '9', suit: 'spades', copyIndex: 0 },
    });
  });

  it('breaks an equal-rank, equal-suit tie by copyIndex', () => {
    const state = trickState(0, [card('9', 'spades', 1), card('9', 'spades', 0)], 'clubs');
    expect(TimeoutMove(state)).toEqual({
      type: 'playCard',
      seat: 0,
      card: { rank: '9', suit: 'spades', copyIndex: 0 },
    });
  });

  it('following suit restricts the pick to the led suit (never an off-suit lower card)', () => {
    // Led spades; the seat holds a spade and a lower-ranked club. Must follow
    // suit, so K♠ is forced over the off-suit 9♣ the validator excludes.
    const plays: TrickPlay[] = [{ seatIndex: 3, card: card('Q', 'spades') }];
    const state = trickState(0, [card('K', 'spades'), card('9', 'clubs')], 'hearts', plays);
    const forced = TimeoutMove(state);
    expect(forced).toEqual({
      type: 'playCard',
      seat: 0,
      card: { rank: 'K', suit: 'spades', copyIndex: 0 },
    });
  });

  it('must-beat restricts the pick to the beating subset', () => {
    // Led spades, current winner Q♠. The seat holds K♠ (beats) and J♠ (does not).
    // mustBeat forces K♠ — the lowest of the *beating* cards — not the lower J♠.
    const plays: TrickPlay[] = [{ seatIndex: 3, card: card('Q', 'spades') }];
    const state = trickState(0, [card('K', 'spades'), card('J', 'spades')], 'hearts', plays);
    expect(TimeoutMove(state)).toEqual({
      type: 'playCard',
      seat: 0,
      card: { rank: 'K', suit: 'spades', copyIndex: 0 },
    });
  });

  it('always names a card in the LegalPlayValidator set', () => {
    const cases: ReadonlyArray<{ hand: Card[]; trump: Suit; plays: TrickPlay[] }> = [
      { hand: [card('A', 'spades'), card('9', 'clubs')], trump: 'hearts', plays: [] },
      {
        hand: [card('K', 'spades'), card('9', 'clubs')],
        trump: 'hearts',
        plays: [{ seatIndex: 3, card: card('Q', 'spades') }],
      },
      {
        hand: [card('A', 'hearts'), card('9', 'hearts')],
        trump: 'hearts',
        plays: [{ seatIndex: 3, card: card('K', 'clubs') }],
      },
    ];
    for (const { hand, trump, plays } of cases) {
      const state = trickState(0, hand, trump, plays);
      const forced = TimeoutMove(state);
      expect(forced?.type).toBe('playCard');
      const legal = LegalPlayValidator(
        makeHand(0, hand),
        state.public.currentTrick,
        trump,
        SINGLE_DECK_PARTNERS.trick,
      );
      const chosen = forced!.type === 'playCard' ? forced!.card : null;
      expect(
        legal.some(
          (c) =>
            c.rank === chosen!.rank && c.suit === chosen!.suit && c.copyIndex === chosen!.copyIndex,
        ),
      ).toBe(true);
    }
  });
});
