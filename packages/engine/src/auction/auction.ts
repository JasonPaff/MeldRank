import { makeBid, type Bid } from '../domain/entities';

/**
 * The AuctionManager, per "Game Engine — Abstract Model" §5 and both canonical
 * ranked rulesets §4. Pure functions over an auction sub-state: turn order opens
 * left of the dealer and runs clockwise over live seats only; a `bid` must be
 * to-act, live, at or above the floor, and aligned to the increment grid; a
 * `pass` (and, per Ruling 5, a `timeout`) puts a seat out for the hand. The
 * auction terminates when one live seat remains — into a won {@link Bid}, or,
 * when nobody ever bid, by the variant's all-pass rule (dealer forced in at the
 * minimum, or a redeal outcome the room acts on).
 */

/**
 * The auction sub-state. `live[i]` is whether seat `i` is still in the auction
 * (a serializable per-seat flag list, not a `Set`); `toAct` is the seat whose
 * turn it is (always a live seat); `highBid` is the standing high bid or `null`
 * before anyone bids.
 */
export interface AuctionState {
  readonly highBid: Bid | null;
  readonly live: readonly boolean[];
  readonly toAct: number;
}

/** The auction parameters read off the variant's bidding axis. */
export interface AuctionParams {
  readonly minimumBid: number;
  readonly increment: number;
  readonly allPassRule: 'dealer-forced-minimum' | 'redeal';
}

/**
 * The outcome of applying a `bid`/`pass`/`timeout` to the auction:
 * - `rejected` — the move was illegal; the caller leaves state unchanged.
 * - `continue` — a legal move; the auction advances to the next live seat.
 * - `won` — the auction concluded with a winning bid.
 * - `redeal` — an all-pass under the `redeal` rule; the room re-deals.
 */
export type AuctionStep =
  | { readonly status: 'rejected' }
  | { readonly status: 'continue'; readonly auction: AuctionState }
  | { readonly status: 'won'; readonly bid: Bid }
  | { readonly status: 'redeal' };

/** Count the seats still live in the auction. */
function countLive(live: readonly boolean[]): number {
  return live.reduce((total, isLive) => total + (isLive ? 1 : 0), 0);
}

/** The next live seat clockwise from `from` (exclusive). Assumes ≥1 other live seat. */
function nextLiveSeat(live: readonly boolean[], from: number): number {
  const count = live.length;
  for (let step = 1; step <= count; step++) {
    const candidate = (from + step) % count;
    if (live[candidate]) {
      return candidate;
    }
  }
  // Unreachable while ≥2 seats are live (the only context this is called in).
  return from;
}

/**
 * Open the auction: every seat live, the high bid empty, and the turn at the
 * seat to the dealer's left (clockwise), per both rulesets §4.
 */
export function openAuction(playerCount: number, dealerSeat: number): AuctionState {
  return {
    highBid: null,
    live: Array.from({ length: playerCount }, () => true),
    toAct: (dealerSeat + 1) % playerCount,
  };
}

/**
 * Apply a `bid` of `value` by `seat`. Legal only when `seat` is to-act and live,
 * `value` is at least the floor (`highBid + increment`, else `minimumBid`), and
 * `value` sits on the increment grid (`minimumBid + k × increment`). A legal bid
 * becomes the new high bid and advances the turn; an illegal bid is rejected.
 */
export function applyBid(
  auction: AuctionState,
  params: AuctionParams,
  seat: number,
  value: number,
): AuctionStep {
  if (seat !== auction.toAct || !auction.live[seat]) {
    return { status: 'rejected' };
  }

  const floor = auction.highBid ? auction.highBid.value + params.increment : params.minimumBid;
  const onGrid =
    value >= params.minimumBid && (value - params.minimumBid) % params.increment === 0;
  if (value < floor || !onGrid) {
    return { status: 'rejected' };
  }

  return {
    status: 'continue',
    auction: {
      highBid: makeBid(seat, value),
      live: auction.live,
      toAct: nextLiveSeat(auction.live, seat),
    },
  };
}

/**
 * Apply a `pass` by `seat` (the deterministic forced move for an Auction
 * `timeout`, per Ruling 5, routes here too). The seat goes out for the hand. If
 * one live seat then remains, the auction concludes: at the standing high bid if
 * one exists, otherwise by the variant's all-pass rule — `dealer-forced-minimum`
 * forces the dealer in at `minimumBid`, `redeal` yields a redeal outcome.
 * Otherwise the turn advances to the next live seat. An out-of-turn or
 * already-passed `pass` is rejected.
 */
export function applyPass(
  auction: AuctionState,
  params: AuctionParams,
  dealerSeat: number,
  seat: number,
): AuctionStep {
  if (seat !== auction.toAct || !auction.live[seat]) {
    return { status: 'rejected' };
  }

  const live = auction.live.map((isLive, index) => (index === seat ? false : isLive));

  if (countLive(live) === 1) {
    if (auction.highBid) {
      return { status: 'won', bid: auction.highBid };
    }
    if (params.allPassRule === 'dealer-forced-minimum') {
      return { status: 'won', bid: makeBid(dealerSeat, params.minimumBid) };
    }
    return { status: 'redeal' };
  }

  return {
    status: 'continue',
    auction: { highBid: auction.highBid, live, toAct: nextLiveSeat(live, seat) },
  };
}
