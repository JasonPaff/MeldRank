import type { DeckSpec, VariantDefinition } from '@meldrank/shared';
import { makeCard, type Card } from './card';

/**
 * Deck construction, per "Game Engine — Abstract Model" §4. A `Deck` is an
 * ordered multiset built deterministically from a deck spec — *no shuffle* (the
 * provably-fair shuffle is owned by Match Runtime, not the engine).
 */

/**
 * The multiset a deck is built from (which ranks and suits, and how many copies
 * of each rank+suit) is the variant schema's `DeckSpec`, re-exported type-only
 * so the engine reads it without a runtime dependency and without re-declaring
 * the shape.
 */
export type { DeckSpec };

/** An ordered deck of cards. */
export type Deck = readonly Card[];

/** Read the deck spec off a validated `VariantDefinition`. */
export function deckSpecFromVariant(variant: VariantDefinition): DeckSpec {
  return variant.deck;
}

/**
 * Build a deck from a spec, deterministically: suits outer, ranks next, copies
 * innermost, so two builds of the same spec produce the same cards in the same
 * order. The single-deck spec (6 ranks × 4 suits × 2 copies) yields 48 cards.
 */
export function buildDeck(spec: DeckSpec): Card[] {
  const cards: Card[] = [];
  for (const suit of spec.suits) {
    for (const rank of spec.ranks) {
      for (let copyIndex = 0; copyIndex < spec.copiesPerCard; copyIndex++) {
        cards.push(makeCard(rank, suit, copyIndex));
      }
    }
  }
  return cards;
}

/** Convenience: build the deck for a given variant. */
export function buildDeckForVariant(variant: VariantDefinition): Card[] {
  return buildDeck(deckSpecFromVariant(variant));
}
