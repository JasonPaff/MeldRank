import type { CounterValues, Suit } from '@meldrank/shared';
import type { Trick } from '../domain/entities';
import { winningPlay } from './strength';

/**
 * The TrickResolver, per "Game Engine — Abstract Model" §5 and design D4. A pure
 * `(trick, trump) → winnerSeatIndex` over a *completed* trick, under "Single-Deck
 * Partners" §7: the highest trump wins; with no trump the highest card of the
 * **led** suit wins; a card neither trump nor of the led suit cannot win. On two
 * identical winning cards the one played first wins
 * (`identicalCardTie: 'first-played-wins'`), which falls out of the shared
 * strictly-greater-replaces scan. Mutates nothing; deterministic.
 */
export function TrickResolver(trick: Trick, trump: Suit): number {
  // A completed trick always has a led suit and at least one play.
  const ledSuit = trick.ledSuit!;
  return winningPlay(trick.plays, trump, ledSuit).seatIndex;
}

/**
 * The counter points a completed trick captures: the sum of each played card's
 * per-rank counter value from `scoring.counters` (A=11, 10=10, K=4, Q=3, J=2,
 * 9=0 canonically). The last-trick **bonus** is not included here — it depends on
 * whether this is the final trick, a `reduce`-level fact applied on the last
 * trick (design D4).
 */
export function capturedCounters(trick: Trick, counters: CounterValues): number {
  return trick.plays.reduce((sum, play) => sum + counters[play.card.rank], 0);
}
