import type { Card, Rank, Suit } from '../domain/card';
import type { TrickPlay } from '../domain/entities';

/**
 * The single card-strength comparator both trick modules share, per design D2.
 * Pinochle strength is only defined *relative to a trick*: a trump outranks any
 * non-trump, and among trumps (and among led-suit cards) the locked ranking
 * `A > 10 > K > Q > J > 9` decides. A card that is neither trump nor of the led
 * suit was a void discard and cannot win. One comparator answers both
 * "does this card beat the current winner?" (must-beat) and "which play wins?"
 * (resolve), so the validator and the resolver can never disagree.
 */

/**
 * The locked rank ordinal `A > 10 > K > Q > J > 9` (§2 of the ruleset): higher
 * is stronger. A constant, not a variant axis — the ranking is fixed.
 */
const RANK_ORDINAL: Readonly<Record<Rank, number>> = {
  A: 5,
  '10': 4,
  K: 3,
  Q: 2,
  J: 1,
  '9': 0,
};

/** The strength tiers, spaced so a trump always outranks any led-suit card. */
const TRUMP_TIER = 200;
const LED_TIER = 100;
const CANNOT_WIN = 0;

/**
 * Rank a `card` within a trick context (the declared `trump` and the `ledSuit`).
 * Returns a single comparable strength: trumps occupy the highest tier, led-suit
 * cards the next, and anything else cannot win. Within a winning tier the rank
 * ordinal breaks the order. Two cards tie in strength only when they are the two
 * copies of the same rank+suit; the first-played-wins tie-break is applied by the
 * scanning helpers, not here.
 *
 * When trump is itself led (`ledSuit === trump`), led cards are trumps and fall
 * in the trump tier — checking trump first makes that automatic.
 */
export function trickStrength(card: Card, trump: Suit, ledSuit: Suit): number {
  if (card.suit === trump) {
    return TRUMP_TIER + RANK_ORDINAL[card.rank];
  }
  if (card.suit === ledSuit) {
    return LED_TIER + RANK_ORDINAL[card.rank];
  }
  return CANNOT_WIN;
}

/**
 * The play currently winning the trick: a stable "strictly greater replaces"
 * scan over `plays` in order, so on identical winning cards the one played first
 * stays winner (`identicalCardTie: 'first-played-wins'`). `plays` must be
 * non-empty and `ledSuit` is the trick's led suit.
 */
export function winningPlay(plays: readonly TrickPlay[], trump: Suit, ledSuit: Suit): TrickPlay {
  let best = plays[0]!;
  let bestStrength = trickStrength(best.card, trump, ledSuit);
  for (let i = 1; i < plays.length; i++) {
    const strength = trickStrength(plays[i]!.card, trump, ledSuit);
    if (strength > bestStrength) {
      best = plays[i]!;
      bestStrength = strength;
    }
  }
  return best;
}
