import type { Rank, Suit } from '../variant/schema';

/**
 * The locked player **intent** payload types, per "API Surface & Contracts" §4 —
 * the wire messages a seated player can submit (`bid`, `pass`, `declareTrump`,
 * `playCard`, and the bury-variant-only `bury`). These are *types only*: they are
 * the contract the `@meldrank/engine` reducer consumes (type-only, so the engine
 * stays zero-runtime-dependency) and the shape later Match Service / client wiring
 * will validate with Zod. The matching Zod schemas arrive when that boundary is
 * built; nothing in this slice needs runtime validation.
 *
 * `bury` extends the four originally-locked intents (a contract change flagged in
 * the design): only the bid winner emits it, and only in bury-enabled variants
 * (Cutthroat); the ranked Partners path never produces one.
 *
 * System events that have no player intent (the seed-driven `deal`, the clock
 * `timeout`) are *not* here — they are modelled inside the engine's `Event`
 * union, which composes these intents with those system events.
 */

/**
 * A reference to a specific physical card on the wire: its rank, suit, and the
 * 0-based `copyIndex` distinguishing the two identical copies in a pinochle deck.
 * Mirrors the engine's `Card` shape without coupling the wire contract to it.
 */
export interface CardRef {
  readonly rank: Rank;
  readonly suit: Suit;
  readonly copyIndex: number;
}

/** A seat bids a value in the auction. */
export interface BidIntent {
  readonly type: 'bid';
  readonly seat: number;
  readonly value: number;
}

/** A seat passes (out for the hand) in the auction. */
export interface PassIntent {
  readonly type: 'pass';
  readonly seat: number;
}

/** The bid winner names the trump suit. */
export interface DeclareTrumpIntent {
  readonly type: 'declareTrump';
  readonly seat: number;
  readonly trump: Suit;
}

/** A seat plays a card to the current trick. */
export interface PlayCardIntent {
  readonly type: 'playCard';
  readonly seat: number;
  readonly card: CardRef;
}

/**
 * The bid winner discards `dealing.bury.size` cards face-down after absorbing the
 * widow (bury-enabled variants only). One atomic intent carries the whole bury
 * set — the bidder selects the cards and confirms once.
 */
export interface BuryIntent {
  readonly type: 'bury';
  readonly seat: number;
  readonly cards: readonly CardRef[];
}

/** The closed union of the locked player intents. */
export type PlayerIntent = BidIntent | PassIntent | DeclareTrumpIntent | PlayCardIntent | BuryIntent;

/**
 * The discriminant kinds of {@link PlayerIntent}: `bid` | `pass` | `declareTrump`
 * | `playCard` | `bury`.
 */
export type PlayerIntentKind = PlayerIntent['type'];
