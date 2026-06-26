import type { BuryRestriction, Suit } from '@meldrank/shared';
import type { Hand, Meld } from '../domain/entities';
import { cardsIdentical, type Card } from '../domain/card';

/**
 * The bury-validator, per "Single-Deck Cutthroat / Auction Pinochle" §6 / Ruling 5
 * and design D2. A pure `(hand, melds, trump, restrictions) → Card[]` that returns
 * the subset of the bidder's hand eligible to be buried face-down, applying each
 * restriction in the variant's `dealing.bury.restrictions`. A card is buryable
 * only if it violates **no** active restriction. It mutates nothing, is
 * deterministic, and reads only plain data (zero runtime dependencies —
 * `Suit`/`BuryRestriction` are type-only).
 *
 * The three restrictions:
 * - **`no-melded`** — exclude any card whose *identity* (rank, suit, and
 *   `copyIndex`) matches a card the bidder laid in meld. By identity, so an
 *   *unused* second copy of a melded value stays buryable.
 * - **`no-trump`** — exclude any card of the `trump` suit.
 * - **`no-dix`** — exclude the `9` of `trump` (the dix). Redundant with `no-trump`
 *   for the canonical Cutthroat set, but applied independently so a casual variant
 *   carrying only `no-dix` still behaves correctly.
 */
export function buryableCards(hand: Hand, melds: readonly Meld[], trump: Suit, restrictions: readonly BuryRestriction[]): Card[] {
  const noMelded = restrictions.includes('no-melded');
  const noTrump = restrictions.includes('no-trump');
  const noDix = restrictions.includes('no-dix');

  // The bidder's melded cards, flattened across meld classes (reuse across classes
  // is fine — `cardsIdentical` dedups by identity).
  const meldedCards = melds.flatMap((meld) => meld.cards);

  return hand.cards.filter((card) => {
    if (noMelded && meldedCards.some((melded) => cardsIdentical(melded, card))) {
      return false;
    }
    if (noTrump && card.suit === trump) {
      return false;
    }
    if (noDix && card.suit === trump && card.rank === '9') {
      return false;
    }
    return true;
  });
}
