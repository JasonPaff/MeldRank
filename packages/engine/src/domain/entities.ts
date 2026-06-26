import type { Card, Suit } from './card';

/**
 * The remaining core domain entities, per "Game Engine — Abstract Model" §4.
 * Pure data with thin constructors only — no rules logic. These types must be
 * expressive enough to represent any state the later engine modules (Dealer,
 * AuctionManager, MeldDetector, TrickResolver, scorers) produce, without
 * encoding how those states are computed.
 */

/** The cards a seat holds. */
export interface Hand {
  readonly seatIndex: number;
  readonly cards: readonly Card[];
}

/** Construct a {@link Hand} for a seat. */
export function makeHand(seatIndex: number, cards: readonly Card[]): Hand {
  return { seatIndex, cards };
}

/** A single bid in the auction: the bidding seat and the value bid. */
export interface Bid {
  readonly seatIndex: number;
  readonly value: number;
}

/** Construct a {@link Bid}. */
export function makeBid(seatIndex: number, value: number): Bid {
  return { seatIndex, value };
}

/**
 * The auction result: the winning seat, the contract value, and the trump suit
 * declared by the winner.
 */
export interface Contract {
  readonly seatIndex: number;
  readonly value: number;
  readonly trump: Suit;
}

/** Construct a {@link Contract} from the winning seat, value, and declared trump. */
export function makeContract(seatIndex: number, value: number, trump: Suit): Contract {
  return { seatIndex, value, trump };
}

/**
 * A meld's scoring class. Within a class, a card may not be reused across melds;
 * across classes a card may be reused. Later scoring enforces those rules; the
 * `Meld` only records the class.
 */
export type MeldClass = 'A' | 'B' | 'C';

/**
 * A scored meld: its `type` (e.g. a run, a pinochle), the contributing `cards`,
 * its point `value`, and its `class` for cross-class reuse rules.
 */
export interface Meld {
  readonly type: string;
  readonly cards: readonly Card[];
  readonly value: number;
  readonly class: MeldClass;
}

/** Construct a {@link Meld}. */
export function makeMeld(
  type: string,
  cards: readonly Card[],
  value: number,
  meldClass: MeldClass,
): Meld {
  return { type, cards, value, class: meldClass };
}

/** One play within a trick: the seat that played and the card it played. */
export interface TrickPlay {
  readonly seatIndex: number;
  readonly card: Card;
}

/**
 * A trick: the led suit, the plays in order, and the resolved winning seat
 * (`null` until resolved by later trick logic).
 */
export interface Trick {
  readonly ledSuit: Suit | null;
  readonly plays: readonly TrickPlay[];
  readonly winnerSeatIndex: number | null;
}

/** Construct a {@link Trick}. Defaults to an empty, unresolved trick. */
export function makeTrick(
  ledSuit: Suit | null = null,
  plays: readonly TrickPlay[] = [],
  winnerSeatIndex: number | null = null,
): Trick {
  return { ledSuit, plays, winnerSeatIndex };
}

/**
 * One side's score for a single hand: the meld points, the counter (trick)
 * points, and their total. `side` is a team id (partnership variants) or a seat
 * index (free-for-all variants).
 */
export interface HandScoreLine {
  readonly side: number;
  readonly meld: number;
  readonly counters: number;
  readonly total: number;
}

/** Construct a {@link HandScoreLine}, computing the total from meld + counters. */
export function makeHandScoreLine(side: number, meld: number, counters: number): HandScoreLine {
  return { side, meld, counters, total: meld + counters };
}

/**
 * The running scorepad: the per-side lines for each played hand, plus cumulative
 * totals by side. Pure data; helpers below return new pads rather than mutating.
 */
export interface ScorePad {
  readonly hands: readonly (readonly HandScoreLine[])[];
  readonly cumulative: Readonly<Record<number, number>>;
}

/** An empty scorepad with no hands recorded. */
export function createScorePad(): ScorePad {
  return { hands: [], cumulative: {} };
}

/**
 * Append a hand's per-side lines to a scorepad, returning a new pad with the
 * cumulative totals advanced. Pure — the input pad is not mutated.
 */
export function appendHand(pad: ScorePad, lines: readonly HandScoreLine[]): ScorePad {
  const cumulative: Record<number, number> = { ...pad.cumulative };
  for (const line of lines) {
    cumulative[line.side] = (cumulative[line.side] ?? 0) + line.total;
  }
  return { hands: [...pad.hands, lines], cumulative };
}
