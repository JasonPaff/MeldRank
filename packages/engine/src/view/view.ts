import type { Card } from '../domain/card';
import type { PublicState, State } from '../state/state';

/**
 * The per-seat **filtered view** — the hidden-information boundary the Match
 * Runtime enforces, expressed as a pure engine-level projection over the full
 * `State` (Match Runtime — Design v1 §3/§4). The engine deliberately splits
 * `State` into a table-visible `PublicState` and per-seat `PrivateState` "so the
 * Match Service's per-seat filtering is a mechanical projection, not a bespoke
 * walk" (`state/state.ts`); {@link viewFor} is that projection.
 *
 * The type is engineered so hidden information is *unrepresentable* rather than
 * merely *omitted* (design D2): a {@link FilteredView} has **no `private` member
 * and no per-seat `hands` array**, so there is simply no field capable of holding
 * another seat's cards or the unrevealed widow. Excluding hidden state is a
 * property of the type, checked at compile time — not a runtime convention that a
 * careless caller could defeat.
 */

/**
 * The viewer's own private region (design D4): the seat's own hand and — for the
 * bidder only — its own face-down buried pile. Read directly from the viewer's
 * own slice of `PrivateState`, so no other seat's contents can appear here.
 */
export interface OwnRegion {
  /** The viewer's own hand contents (`state.private.hands[viewer].cards`). */
  readonly hand: readonly Card[];
  /**
   * The viewer's own buried pile (design D4, V1). Non-empty only for the bidder
   * on a bury-enabled variant; empty for every non-bidder and on the non-bury
   * (Partners) path.
   */
  readonly buried: readonly Card[];
}

/**
 * A complete filtered view for one viewer (design D2/D3). Carries the viewer's
 * identity, the public state verbatim, the viewer's own region (or `null` for a
 * spectator), and contents-free per-seat hand sizes.
 */
export interface FilteredView {
  /** The viewing seat index, or `null` for a spectator (design D3). */
  readonly viewer: number | null;
  /** The table-visible public state, reused verbatim (design D2). */
  readonly public: PublicState;
  /** The viewer's own region, or `null` for a spectator (design D3). */
  readonly own: OwnRegion | null;
  /**
   * Per-seat card counts indexed by seat (design D5, V2): `handSizes[i]` is the
   * number of cards seat `i` holds. A plain number per seat — structurally
   * incapable of carrying card identity — so a client can render every
   * opponent's card backs.
   */
  readonly handSizes: readonly number[];
}

/**
 * Derive the {@link FilteredView} a single viewer is entitled to see from the
 * full engine `State` (design D1; spec `seat-view-projector`). Pure,
 * non-mutating, and deterministic — identical `(state, viewer)` inputs always
 * produce an equal result. The function shares references into the immutable
 * `State` rather than copying (design Risks — "Shallow vs. deep copying"); the
 * `readonly` types plus the no-mutation guarantee keep that safe.
 *
 * - `public` passes through verbatim — it is already the table-visible set.
 * - `handSizes` is derived from each dealt seat's hand length (design D5, V2),
 *   counts only.
 * - A seat index yields an `own` region holding **only** that seat's own hand
 *   (design D4) and, for the bidder, its own buried pile (V1).
 * - `viewer === null` is the spectator (design D3, V3): `own` is `null`; the view
 *   carries public state and hand-size counts only.
 * - `state.private.widow` is **never** referenced (design D7): the unrevealed
 *   widow has no path into any view; the table sees it only via
 *   `public.revealedWidow` once the lifecycle reveals it.
 *
 * @throws {RangeError} when `viewer` is a seat index that is not a dealt seat in
 *   the current `State` — a silently-empty view would mask a caller bug such as a
 *   room mis-routing a recipient (design D6). The spectator (`null`) is the only
 *   legitimate "no own hand" case and is explicit.
 */
export function viewFor(state: State, viewer: number | null): FilteredView {
  // Contents-free per-seat counts, indexed by seat. `hands` is indexed by seat
  // (`hands[i].seatIndex === i`), so mapping preserves seat order (design D5).
  const handSizes: readonly number[] = state.private.hands.map((hand) => hand.cards.length);

  // Spectator: public state and counts only, no own region (design D3, V3).
  if (viewer === null) {
    return { viewer: null, public: state.public, own: null, handSizes };
  }

  // Reject an undealt / invalid seat rather than fabricating a hand (design D6).
  if (!Number.isInteger(viewer) || viewer < 0 || viewer >= state.private.hands.length) {
    throw new RangeError(`viewFor: seat ${viewer} is not a dealt seat (have ${state.private.hands.length})`);
  }

  // The bidder's buried pile is a single, bidder-owned face-down pile in
  // `PrivateState` (not a per-seat slice). It is the viewer's own information
  // only when the viewer is the bid winner; every other seat sees no buried
  // contents (V1). With no contract yet, or on the non-bury path, the pile is
  // empty, so non-bidders get an empty pile either way.
  const bidderSeat = state.public.contract?.seatIndex ?? null;
  const own: OwnRegion = {
    hand: state.private.hands[viewer]!.cards,
    buried: viewer === bidderSeat ? state.private.buried : [],
  };

  return { viewer, public: state.public, own, handSizes };
}
