import type { Suit, VariantDefinition } from '@meldrank/shared';
import type { LifecyclePhase } from '../lifecycle/phases';
import {
  createScorePad,
  makeContract,
  makeTrick,
  type Bid,
  type Contract,
  type Hand,
  type Meld,
  type ScorePad,
  type Trick,
} from '../domain/entities';
import type { Card } from '../domain/card';
import type { AuctionState } from '../auction/auction';
import type { HandResult } from '../score/score';
import type { MatchResult } from '../match/match';

/**
 * The engine's `State`, per design decisions 5 and the "Public and private state
 * separation" requirement. A plain, JSON-round-trippable value (no class
 * instances, no `Map`/`Set`, no behaviour) so it folds for replay, filters per
 * seat, and maps to a Colyseus schema. Public regions (phase, turn, auction
 * standing, recorded `Bid`, any redeal signal) are kept structurally distinct
 * from per-seat private regions (each seat's hand, the unrevealed widow) so the
 * Match Service's per-seat filtering is a mechanical projection, not a bespoke
 * walk. The engine structures the state for filtering; it does not filter.
 */

/**
 * A melding seat's recorded meld (design D4): the seat, its laid-down `Meld[]`,
 * and their `total`. Meld is laid face-up for the whole table ("Single-Deck
 * Partners" §6), so it is recorded in public state. Non-melding seats (Cutthroat
 * defenders) get no entry.
 */
export interface SeatMeld {
  readonly seatIndex: number;
  readonly melds: readonly Meld[];
  readonly total: number;
}

/**
 * A seat's running trick-capture tally during `TrickPlay` (design D6): the
 * captured counter points (including the last-trick bonus once the hand ends) and
 * the number of tricks taken. Tallied per **seat**, not per side — folding seats
 * into sides and applying the meld-needs-a-trick gate is `HandScoring`'s job. Every
 * dealt seat is present from the moment `TrickPlay` is entered.
 */
export interface SeatCapture {
  readonly seatIndex: number;
  readonly counters: number;
  readonly tricksTaken: number;
}

/** The table-visible state every seat may see. */
export interface PublicState {
  /** The current lifecycle phase marker. */
  readonly phase: LifecyclePhase;
  /** The dealer's seat index (fixes turn order and the all-pass forced bid). */
  readonly dealerSeat: number;
  /** The seat whose turn it is, or `null` when no seat is to act (e.g. Dealing). */
  readonly seatToAct: number | null;
  /** The live auction standing while bidding, or `null` outside the Auction phase. */
  readonly auction: AuctionState | null;
  /** The recorded winning bid once the auction concludes, else `null`. */
  readonly contract: Bid | null;
  /** The trump suit once the bid winner declares it, else `null` (design D1). */
  readonly trump: Suit | null;
  /**
   * The widow once it is revealed to the table (widow variants), else empty. The
   * canonical widow is `exposed`, so the reveal is recorded publicly (design D2).
   */
  readonly revealedWidow: readonly Card[];
  /**
   * Each melding seat's computed meld, recorded once the lifecycle passes through
   * `Melding` (design D4). Empty until then; carries only the melding seats
   * (all seats for Partners, the bidder only for Cutthroat).
   */
  readonly melds: readonly SeatMeld[];
  /**
   * The trick in progress during `TrickPlay` — its led suit and ordered plays —
   * empty between tricks. Every play is face-up (§7), so it is public (design D6).
   */
  readonly currentTrick: Trick;
  /**
   * Each resolved trick of the hand, in order, carrying its `winnerSeatIndex`
   * for replay/render and the `HandScoring` fold (design D6).
   */
  readonly completedTricks: readonly Trick[];
  /** The per-seat captured-counter / tricks-taken tally (design D6). */
  readonly captured: readonly SeatCapture[];
  /**
   * The scored per-side hand result (lines + made/set verdict) for the just-
   * finished hand, computed when the lifecycle reaches `HandScoring`; `null`
   * until then (design D7).
   */
  readonly handResult: HandResult | null;
  /**
   * The running scorepad — per-hand lines plus cumulative-by-side totals — that
   * the eventual `MatchScorer` reads to evaluate the match-end condition (design
   * D7). A hand's lines are appended at `HandScoring`.
   */
  readonly scorePad: ScorePad;
  /**
   * **Match scope** (design D4). Per-side count of hands that side **bid and
   * made** — the Ruling 2 placement tiebreak `MatchScorer` reads. Initialized
   * empty; incremented at each `HandScoring` for `handResult.side` when the hand
   * was made. Preserved across hands of a match (it is not a per-hand field).
   */
  readonly handsMadeAsBidder: Readonly<Record<number, number>>;
  /**
   * **Match scope** (design D4). The final `MatchResult` (standings + rating
   * basis) once the lifecycle reaches `MatchComplete`; `null` for every phase
   * before the match ends.
   */
  readonly matchResult: MatchResult | null;
  /** A `redeal` signal for the room to re-deal (Cutthroat all-pass), else `null`. */
  readonly outcome: 'redeal' | null;
}

/** The per-seat hidden state, structured so Match Runtime can filter it per seat. */
export interface PrivateState {
  /** Each seat's hand, by seat index. */
  readonly hands: readonly Hand[];
  /** The widow, unrevealed until the WidowReveal phase. */
  readonly widow: readonly Card[];
}

/**
 * The full engine state: the driving `variant` (plain validated data, carried so
 * `reduce` reads auction parameters, the deck spec, and the active path without
 * a side channel) plus its public and private regions.
 */
export interface State {
  readonly variant: VariantDefinition;
  readonly public: PublicState;
  readonly private: PrivateState;
}

/**
 * The initial state for a hand: phase `Dealing`, the given dealer, no seat to
 * act yet, and empty hands/widow awaiting the `deal` event. `dealerSeat`
 * defaults to seat 0.
 */
export function createInitialState(variant: VariantDefinition, dealerSeat = 0): State {
  return {
    variant,
    public: {
      phase: 'Dealing',
      dealerSeat,
      seatToAct: null,
      auction: null,
      contract: null,
      trump: null,
      revealedWidow: [],
      melds: [],
      currentTrick: makeTrick(),
      completedTricks: [],
      captured: [],
      handResult: null,
      scorePad: createScorePad(),
      handsMadeAsBidder: {},
      matchResult: null,
      outcome: null,
    },
    private: { hands: [], widow: [] },
  };
}

/**
 * The domain `Contract` assembled from the split public state (design D1): the
 * recorded winning `Bid` (`seatIndex`, `value`) plus the declared `trump`.
 * Returns `null` until both are present, so a consumer (MeldDetector, scorers)
 * never reads a half-formed contract.
 */
export function getContract(state: State): Contract | null {
  const { contract, trump } = state.public;
  if (contract === null || trump === null) {
    return null;
  }
  return makeContract(contract.seatIndex, contract.value, trump);
}
