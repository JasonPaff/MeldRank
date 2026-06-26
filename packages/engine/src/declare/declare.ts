import type { Suit } from '../domain/card';
import type { Bid } from '../domain/entities';

/**
 * The DeclareTrump phase driver, per "Game Engine — Abstract Model" §2/§5 and
 * design decision 3. A single pure function the reducer folds: a `declareTrump`
 * is legal iff the declaring seat is the contract winner and the named suit is
 * one of the active deck's suits. Both canonical rulesets set `trumpDeclaredBy:
 * 'bid-winner'` and neither requires the winner to hold a card of the suit, so
 * there is no must-hold rule here (a future variant axis, not engine-hardcoded).
 */

/**
 * The outcome of applying a `declareTrump`:
 * - `rejected` — illegal (non-winner seat or an unknown suit); the caller leaves
 *   state unchanged.
 * - `declared` — legal; the caller records `trump` and advances the phase.
 */
export type DeclareStep =
  | { readonly status: 'rejected' }
  | { readonly status: 'declared'; readonly trump: Suit };

/**
 * Apply a `declareTrump` of `trump` by `seat`. Legal only when `contract` is the
 * recorded won bid, `seat` equals its winning seat, and `trump` is one of
 * `deckSuits` (the active deck's suits). The phase guard (only reachable in
 * `DeclareTrump`) is the reducer's responsibility; this validates seat and suit.
 */
export function declareTrump(
  contract: Bid | null,
  deckSuits: readonly Suit[],
  seat: number,
  trump: Suit,
): DeclareStep {
  if (contract === null || seat !== contract.seatIndex) {
    return { status: 'rejected' };
  }
  if (!deckSuits.includes(trump)) {
    return { status: 'rejected' };
  }
  return { status: 'declared', trump };
}
