import { describe, expect, it } from 'vitest';
import {
  SINGLE_DECK_CUTTHROAT,
  SINGLE_DECK_PARTNERS,
  type VariantDefinition,
} from '@meldrank/shared';
import { reduce, createInitialState, type Event, type State } from '../index';
import { cardIdentityKey, makeCard } from '../domain/card';
import { makeHand } from '../domain/entities';
import { revealWidow } from './widow';

/** Fold an ordered event log over `reduce` from a fresh initial state. */
function fold(variant: VariantDefinition, dealerSeat: number, log: readonly Event[]): State {
  return log.reduce(
    (state, event) => reduce(state, event),
    createInitialState(variant, dealerSeat),
  );
}

/** A multiset of card identity keys for every card across all hands and the widow. */
function dealtMultiset(state: State): Record<string, number> {
  const counts: Record<string, number> = {};
  const cards = [...state.private.hands.flatMap((hand) => hand.cards), ...state.private.widow];
  for (const card of cards) {
    const key = cardIdentityKey(card);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

describe('revealWidow (pure)', () => {
  it("appends the widow to the winner's hand and empties the widow", () => {
    const hands = [
      makeHand(0, [makeCard('A', 'spades', 0)]),
      makeHand(1, [makeCard('K', 'hearts', 0)]),
    ];
    const widow = [makeCard('9', 'clubs', 0), makeCard('Q', 'diamonds', 1)];

    const result = revealWidow(hands, widow, 1);

    expect(result.widow).toEqual([]);
    expect(result.revealedWidow).toEqual(widow);
    expect(result.hands[0]).toBe(hands[0]); // untouched seat keeps its hand
    expect(result.hands[1]!.cards).toEqual([makeCard('K', 'hearts', 0), ...widow]);
  });

  it('does not mutate the input hands or widow', () => {
    const hands = [makeHand(0, [makeCard('A', 'spades', 0)])];
    const widow = [makeCard('9', 'clubs', 0)];

    revealWidow(hands, widow, 0);

    expect(hands[0]!.cards).toHaveLength(1);
    expect(widow).toHaveLength(1);
  });
});

describe('reduce — WidowReveal pass-through', () => {
  /** A Cutthroat auction won by seat 1 (dealer 0): seat 1 bids, others pass. */
  const cutthroatWon: Event[] = [
    { type: 'deal', seed: 99 },
    { type: 'bid', seat: 1, value: 300 },
    { type: 'pass', seat: 2 },
    { type: 'pass', seat: 0 },
  ];

  it("reveals the widow into the winner's hand (15 → 18) and settles at DeclareTrump", () => {
    const final = fold(SINGLE_DECK_CUTTHROAT, 0, cutthroatWon);

    expect(final.public.phase).toBe('DeclareTrump');
    expect(final.private.hands[1]!.cards).toHaveLength(18);
    // The other seats are unchanged.
    expect(final.private.hands[0]!.cards).toHaveLength(15);
    expect(final.private.hands[2]!.cards).toHaveLength(15);
    expect(final.private.widow).toEqual([]);
  });

  it('records the revealed widow in public state', () => {
    const dealt = fold(SINGLE_DECK_CUTTHROAT, 0, [{ type: 'deal', seed: 99 }]);
    const final = fold(SINGLE_DECK_CUTTHROAT, 0, cutthroatWon);

    expect(final.public.revealedWidow).toHaveLength(3);
    expect(final.public.revealedWidow).toEqual(dealt.private.widow);
  });

  it('preserves the dealt cards as a multiset across the reveal', () => {
    const dealt = fold(SINGLE_DECK_CUTTHROAT, 0, [{ type: 'deal', seed: 99 }]);
    const final = fold(SINGLE_DECK_CUTTHROAT, 0, cutthroatWon);

    expect(dealtMultiset(final)).toEqual(dealtMultiset(dealt));
  });

  it('performs no reveal for a no-widow variant (Partners advances straight to DeclareTrump)', () => {
    const final = fold(SINGLE_DECK_PARTNERS, 0, [
      { type: 'deal', seed: 2024 },
      { type: 'bid', seat: 1, value: 250 },
      { type: 'pass', seat: 2 },
      { type: 'pass', seat: 3 },
      { type: 'pass', seat: 0 },
    ]);

    expect(final.public.phase).toBe('DeclareTrump');
    expect(final.public.revealedWidow).toEqual([]);
    expect(final.private.widow).toEqual([]);
    expect(final.private.hands.every((hand) => hand.cards.length === 12)).toBe(true);
  });
});
