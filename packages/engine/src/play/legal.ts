import type { Suit, TrickRules } from '@meldrank/shared';
import type { Hand, Trick } from '../domain/entities';
import type { Card } from '../domain/card';
import { trickStrength, winningPlay } from './strength';

/**
 * The LegalPlayValidator, per "Game Engine — Abstract Model" §5 and design D3.
 * A pure `(hand, trick, trump, trickRules) → Card[]` that returns the subset of
 * the seat's hand the seat may legally play into the in-progress `trick`, under
 * "Single-Deck Partners" §7. It mutates nothing, is deterministic, and reads only
 * plain data (zero runtime dependencies — `TrickRules`/`Suit` are type-only).
 *
 * The obligation cascade is gated on each `trickRules` flag so a casual variant
 * that relaxes follow-suit, must-trump, or must-beat is served by the same
 * function with no engine fork. The result is always non-empty for a non-empty
 * hand: a seat always has at least one legal play.
 */
export function LegalPlayValidator(hand: Hand, trick: Trick, trump: Suit, trickRules: TrickRules): Card[] {
  const { cards } = hand;

  // The leader (empty trick) may play any card.
  if (trick.plays.length === 0) {
    return [...cards];
  }

  // A non-empty trick always has a led suit and a current winning play.
  const ledSuit = trick.ledSuit!;
  const winner = winningPlay(trick.plays, trump, ledSuit);
  const winnerStrength = trickStrength(winner.card, trump, ledSuit);

  // 1. Follow suit when able, then must-head (strict must-beat) on the led suit.
  const ledCards = cards.filter((card) => card.suit === ledSuit);
  if (trickRules.mustFollowSuit && ledCards.length > 0) {
    if (trickRules.mustBeat) {
      const beating = ledCards.filter((card) => trickStrength(card, trump, ledSuit) > winnerStrength);
      return beating.length > 0 ? beating : ledCards;
    }
    return ledCards;
  }

  // 2. Must trump when void in the led suit, then over-trump if the trick is
  //    already won by a trump. (A trump always beats a non-trump winner, so the
  //    over-trump restriction only binds when the current winner is itself trump.)
  const trumpCards = cards.filter((card) => card.suit === trump);
  if (trickRules.mustTrumpWhenVoid && ledCards.length === 0 && trumpCards.length > 0) {
    if (trickRules.mustBeat && winner.card.suit === trump) {
      const beating = trumpCards.filter((card) => trickStrength(card, trump, ledSuit) > winnerStrength);
      return beating.length > 0 ? beating : trumpCards;
    }
    return trumpCards;
  }

  // 3. Otherwise (void with no trump, or the flags relax the above): free discard.
  return [...cards];
}
