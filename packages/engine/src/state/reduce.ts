import type { DeclareTrumpIntent, VariantDefinition } from '@meldrank/shared';
import { isLegalTransition, resolveActivePath, type LifecyclePhase } from '../lifecycle/phases';
import { createSeededRng } from '../dealer/rng';
import { deal } from '../dealer/deal';
import { applyBid, applyPass, openAuction, type AuctionStep } from '../auction/auction';
import { revealWidow } from '../widow/widow';
import { declareTrump } from '../declare/declare';
import type { State } from './state';
import type { DealEvent, Event } from './events';

/**
 * `reduce(state, event): State` — the engine's single public driver, per design
 * decisions 1 and 6 and the "Pure reduce state container" requirement. Pure,
 * non-mutating, and deterministic: it phase-guards every event and, when the
 * event is illegal for the current phase (wrong phase, out of turn, off the bid
 * grid, or a not-yet-driven phase), returns the *same* state unchanged — a typed
 * rejection, never a throw on the hot path. The Match Service, the optimistic
 * client, and the replay reconstructor all call this identical function, so they
 * cannot diverge.
 *
 * This change drives the `Dealing → Auction → [WidowReveal] → DeclareTrump →
 * (ready for Melding)` slice: a `deal` populates the hands and widow and opens
 * the auction; `bid`/`pass`/`timeout` drive the auction to a recorded `Bid` (and,
 * for widow variants, a deterministic widow reveal) resting at `DeclareTrump`, or
 * a `redeal` outcome; a `declareTrump` from the contract winner records the trump
 * and advances to `Melding`. `playCard` (and any event in `Melding` and later) is
 * accepted by the type but rejected by the guard until its phase is implemented.
 */
export function reduce(state: State, event: Event): State {
  switch (state.public.phase) {
    case 'Dealing':
      return event.type === 'deal' ? applyDeal(state, event) : state;
    case 'Auction':
      return applyAuctionEvent(state, event);
    case 'DeclareTrump':
      return event.type === 'declareTrump' ? applyDeclareTrump(state, event) : state;
    default:
      // No later phase is driven in this slice; every event (including
      // `playCard`) is rejected without mutation.
      return state;
  }
}

/**
 * Drive the `deal` system event: expand the seed into the shuffle, deal the
 * hands and widow, open the auction at the seat left of the dealer, and advance
 * the phase to the variant's next active phase (`Auction`).
 */
function applyDeal(state: State, event: DealEvent): State {
  const { variant } = state;
  const next = nextActivePhase(variant, 'Dealing');
  if (next === null) {
    return state;
  }

  const rng = createSeededRng(event.seed);
  const { hands, widow } = deal(
    variant.deck,
    variant.dealing.handSize,
    variant.dealing.widow.size,
    rng,
  );
  const auction = openAuction(variant.seating.playerCount, state.public.dealerSeat);

  return {
    variant,
    public: { ...state.public, phase: next, seatToAct: auction.toAct, auction },
    private: { hands, widow },
  };
}

/** Route an Auction-phase event to the auction module (a `timeout` resolves to a pass). */
function applyAuctionEvent(state: State, event: Event): State {
  const auction = state.public.auction;
  if (auction === null) {
    return state;
  }
  const params = {
    minimumBid: state.variant.bidding.minimumBid,
    increment: state.variant.bidding.increment,
    allPassRule: state.variant.bidding.allPassRule,
  };
  const { dealerSeat } = state.public;

  switch (event.type) {
    case 'bid':
      return applyAuctionStep(state, applyBid(auction, params, event.seat, event.value));
    case 'pass':
    case 'timeout':
      return applyAuctionStep(state, applyPass(auction, params, dealerSeat, event.seat));
    default:
      return state;
  }
}

/** Fold an {@link AuctionStep} back into the state. */
function applyAuctionStep(state: State, step: AuctionStep): State {
  switch (step.status) {
    case 'rejected':
      return state;
    case 'continue':
      return {
        ...state,
        public: { ...state.public, auction: step.auction, seatToAct: step.auction.toAct },
      };
    case 'won': {
      const next = nextActivePhase(state.variant, 'Auction');
      if (next === null) {
        return state;
      }
      const won: State = {
        ...state,
        public: { ...state.public, phase: next, contract: step.bid, seatToAct: null },
      };
      // `WidowReveal` has no driving event (design D2): when it is the variant's
      // next active phase, reveal the widow into the bidder's hand and pass
      // through deterministically to the resting phase (`DeclareTrump`).
      return next === 'WidowReveal' ? passThroughWidowReveal(won, step.bid.seatIndex) : won;
    }
    case 'redeal':
      // A redeal is not a lifecycle transition (design decision 4): the room
      // re-deals with the same dealer and a fresh seed. Signal it and hold.
      return { ...state, public: { ...state.public, outcome: 'redeal', seatToAct: null } };
  }
}

/**
 * Pass through the bracketed `WidowReveal` phase deterministically (design D2):
 * reveal the widow into the contract winner's hand, record the exposed widow in
 * public state, and advance to the next active phase (`DeclareTrump`). `state` is
 * the just-concluded auction state already resting at `WidowReveal`.
 */
function passThroughWidowReveal(state: State, winnerSeat: number): State {
  const next = nextActivePhase(state.variant, 'WidowReveal');
  if (next === null) {
    return state;
  }
  const revealed = revealWidow(state.private.hands, state.private.widow, winnerSeat);
  return {
    ...state,
    public: { ...state.public, phase: next, revealedWidow: revealed.revealedWidow },
    private: { hands: revealed.hands, widow: revealed.widow },
  };
}

/**
 * Drive a `declareTrump` during `DeclareTrump`: legal only from the contract
 * winner naming one of the active deck's suits (design D3). A legal declaration
 * records `public.trump` and advances to the variant's next active phase
 * (`Melding`); an illegal one leaves the state unchanged.
 */
function applyDeclareTrump(state: State, event: DeclareTrumpIntent): State {
  const step = declareTrump(
    state.public.contract,
    state.variant.deck.suits,
    event.seat,
    event.trump,
  );
  if (step.status === 'rejected') {
    return state;
  }
  const next = nextActivePhase(state.variant, 'DeclareTrump');
  if (next === null) {
    return state;
  }
  return {
    ...state,
    public: { ...state.public, phase: next, trump: step.trump, seatToAct: null },
  };
}

/**
 * The variant's next active phase after `phase`, via the foundation's active
 * path (bracketed phases the variant disables are already skipped) guarded by
 * the legal-transition table. Returns `null` when `phase` is terminal or the
 * step is not a legal transition — `reduce` never advances along an illegal edge.
 */
function nextActivePhase(variant: VariantDefinition, phase: LifecyclePhase): LifecyclePhase | null {
  const path = resolveActivePath(variant);
  const index = path.indexOf(phase);
  if (index < 0 || index + 1 >= path.length) {
    return null;
  }
  const next = path[index + 1]!;
  return isLegalTransition(phase, next) ? next : null;
}
