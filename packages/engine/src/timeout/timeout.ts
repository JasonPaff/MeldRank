import type { PlayerIntent } from '@meldrank/shared';
import type { Card, Suit } from '../domain/card';
import { LegalPlayValidator, rankValue } from '../play';
import type { State } from '../state/state';

/**
 * `TimeoutMove(state): PlayerIntent | null` — the deterministic forced move, per
 * "Game Engine — Abstract Model" §5 and Ruling 5 (design D1, D2). When the seat
 * currently to act lets its move clock expire, this computes the auditable intent
 * the engine plays on its behalf. Pure, non-mutating, deterministic, and
 * zero-runtime-dependency (it reads only plain `State` data and the
 * `PlayerIntent`/`VariantDefinition` types): the forced move is reproducible from
 * the replay alone. `reduce` feeds the returned intent back through itself, so the
 * forced move passes the identical guards a human move does.
 *
 * Ruling 5 is the pass-legal vs. card-play dichotomy: in a phase where passing is
 * legal (the driven case is `Auction`; future discard-pass phases follow the same
 * rule) the forced move is a `pass`; in a card-play phase (`TrickPlay`) it is the
 * lowest-value legal card. Every other phase — notably `DeclareTrump`, which
 * Ruling 5 does not cover, and all non-acting phases (`seatToAct === null`) —
 * returns `null`, leaving the state unchanged rather than inventing a move
 * (design D5).
 */
export function TimeoutMove(state: State): PlayerIntent | null {
  const seat = state.public.seatToAct;
  if (seat === null) {
    return null;
  }
  switch (state.public.phase) {
    case 'Auction':
      // Passing is legal → the minimal forced action is a pass.
      return { type: 'pass', seat };
    case 'TrickPlay':
      return forcedPlay(state, seat);
    default:
      // No Ruling 5 forced move defined for this phase (e.g. `DeclareTrump`).
      return null;
  }
}

/**
 * The `TrickPlay` arm (design D3): the forced `playCard` for the lowest-value
 * legal card. The candidate set is the `LegalPlayValidator` subset for the
 * in-progress trick, so the pick is legal under follow-suit / must-trump /
 * must-beat — when the validator narrows the hand to "must beat" cards, the
 * lowest of *those* is chosen. The validator guarantees a non-empty set for a
 * non-empty hand, so a seat with cards always yields a concrete play.
 */
function forcedPlay(state: State, seat: number): PlayerIntent | null {
  const { currentTrick, trump } = state.public;
  if (trump === null) {
    return null;
  }
  const hand = state.private.hands[seat];
  if (hand === undefined) {
    return null;
  }
  const legal = LegalPlayValidator(hand, currentTrick, trump, state.variant.trick);
  const card = lowestValueCard(legal, state.variant.deck.suits);
  if (card === undefined) {
    return null;
  }
  return {
    type: 'playCard',
    seat,
    card: { rank: card.rank, suit: card.suit, copyIndex: card.copyIndex },
  };
}

/**
 * The minimum card under the fixed total order (design D3): intrinsic rank value
 * ascending (`9 < J < Q < K < 10 < A`, weakest first), then suit by its index in
 * the deck's canonical `suits` order, then `copyIndex` — a deterministic
 * tiebreak that always resolves the two physical copies. Returns `undefined` only
 * for an empty candidate set.
 */
function lowestValueCard(cards: readonly Card[], suits: readonly Suit[]): Card | undefined {
  let best: Card | undefined;
  for (const card of cards) {
    if (best === undefined || compareCards(card, best, suits) < 0) {
      best = card;
    }
  }
  return best;
}

/** Compare two cards under the rank-then-suit-then-`copyIndex` total order. */
function compareCards(a: Card, b: Card, suits: readonly Suit[]): number {
  const byRank = rankValue(a.rank) - rankValue(b.rank);
  if (byRank !== 0) {
    return byRank;
  }
  const bySuit = suits.indexOf(a.suit) - suits.indexOf(b.suit);
  if (bySuit !== 0) {
    return bySuit;
  }
  return a.copyIndex - b.copyIndex;
}
