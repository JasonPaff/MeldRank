import type { Rank, Suit } from '@meldrank/shared';

/**
 * The `Card` entity and its rank/suit vocabulary, per "Game Engine — Abstract
 * Model" §4. Pure, dependency-free data: pinochle has two physical copies of
 * each card, so a card carries a `copyIndex`, and value-equality (rank+suit) is
 * kept distinct from identity (rank+suit+copyIndex). That separation is
 * load-bearing for later meld and must-beat logic, so it is fixed here.
 */

/**
 * The rank and suit vocabulary is owned by the variant schema in
 * `@meldrank/shared` (the single source of truth that the deck spec is built
 * from). The engine re-exports it type-only — so its domain modules import the
 * vocabulary from one place without the union drifting from the schema, and the
 * zero-runtime-dependency invariant still holds.
 */
export type { Rank, Suit };

/**
 * A single physical card. `copyIndex` (0-based) distinguishes the otherwise
 * identical copies of the same rank+suit within a deck.
 */
export interface Card {
  readonly rank: Rank;
  readonly suit: Suit;
  readonly copyIndex: number;
}

/** Thin constructor for a {@link Card}. */
export function makeCard(rank: Rank, suit: Suit, copyIndex: number): Card {
  return { rank, suit, copyIndex };
}

/**
 * The value key of a card: its rank+suit, ignoring which physical copy it is.
 * Two `9♦` cards share a value key.
 */
export function cardValueKey(card: Card): string {
  return `${card.rank}-${card.suit}`;
}

/**
 * The identity key of a card: rank+suit+copyIndex, unique within a deck. The two
 * `9♦` copies have distinct identity keys.
 */
export function cardIdentityKey(card: Card): string {
  return `${card.rank}-${card.suit}-${card.copyIndex}`;
}

/** True when two cards have the same rank and suit (ignoring `copyIndex`). */
export function cardsValueEqual(a: Card, b: Card): boolean {
  return a.rank === b.rank && a.suit === b.suit;
}

/** True when two cards are the same physical card (rank, suit, and `copyIndex`). */
export function cardsIdentical(a: Card, b: Card): boolean {
  return cardsValueEqual(a, b) && a.copyIndex === b.copyIndex;
}
