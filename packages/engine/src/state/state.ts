import type { VariantDefinition } from '@meldrank/shared';
import type { LifecyclePhase } from '../lifecycle/phases';
import type { Bid, Hand } from '../domain/entities';
import type { Card } from '../domain/card';
import type { AuctionState } from '../auction/auction';

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
      outcome: null,
    },
    private: { hands: [], widow: [] },
  };
}
