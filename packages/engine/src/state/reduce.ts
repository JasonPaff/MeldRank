import type { DeclareTrumpIntent, PlayCardIntent, Suit, VariantDefinition } from '@meldrank/shared';
import { getMeldTable } from '@meldrank/shared/meld';
import { isLegalTransition, resolveActivePath, type LifecyclePhase } from '../lifecycle/phases';
import { createSeededRng } from '../dealer/rng';
import { deal } from '../dealer/deal';
import { applyBid, applyPass, openAuction, type AuctionStep } from '../auction/auction';
import { revealWidow } from '../widow/widow';
import { declareTrump } from '../declare/declare';
import { MeldDetector } from '../meld/meld';
import { LegalPlayValidator, TrickResolver, capturedCounters } from '../play';
import { HandScorer } from '../score/score';
import { cardsIdentical, type Card } from '../domain/card';
import { appendHand, makeHand, makeTrick, type Hand, type Trick } from '../domain/entities';
import { getContract, type SeatCapture, type SeatMeld, type State } from './state';
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
 * Melding → TrickPlay → HandScoring` slice (Partners): a `deal` populates the
 * hands and widow and opens the auction; `bid`/`pass`/`timeout` drive the auction
 * to a recorded `Bid` (and, for widow variants, a deterministic widow reveal)
 * resting at `DeclareTrump`, or a `redeal` outcome; a `declareTrump` from the
 * contract winner records the trump and computes each melding seat's meld through
 * the deterministic `Melding` transition. `TrickPlay` then **rests** and folds
 * repeated `playCard` intents: each is validated against the `LegalPlayValidator`
 * and the seat-to-act, appended to the current trick, and on a complete trick the
 * winner (`TrickResolver`) is credited its captured counters and leads next —
 * looping until hands empty, then advancing to `HandScoring`. `Bury` and any
 * event in `HandScoring` / `MatchComplete` are accepted by the type but rejected
 * by the guard until their phases are implemented.
 */
export function reduce(state: State, event: Event): State {
  switch (state.public.phase) {
    case 'Dealing':
      return event.type === 'deal' ? applyDeal(state, event) : state;
    case 'Auction':
      return applyAuctionEvent(state, event);
    case 'DeclareTrump':
      return event.type === 'declareTrump' ? applyDeclareTrump(state, event) : state;
    case 'TrickPlay':
      return event.type === 'playCard' ? applyPlayCard(state, event) : state;
    default:
      // No later phase is driven in this slice; every event (`Bury`, anything in
      // `HandScoring` / `MatchComplete`) is rejected without mutation.
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
  const declared: State = {
    ...state,
    public: { ...state.public, phase: next, trump: step.trump, seatToAct: null },
  };
  // `Melding` has no driving event (design D3): when it is the next active phase,
  // compute each melding seat's meld and pass through deterministically to the
  // resting phase (`Bury` for Cutthroat, `TrickPlay` for Partners).
  return next === 'Melding' ? passThroughMelding(declared, step.trump) : declared;
}

/**
 * Pass through the `Melding` phase deterministically (design D3): compute each
 * melding seat's meld via the {@link MeldDetector} against the declared `trump`
 * and the variant's meld table, record them in `public.melds`, and advance to the
 * next active phase. `state` is the just-declared state already resting at
 * `Melding`. Melding seats follow `melding.whoMelds` — every seat for `all-seats`
 * (Partners), the contract seat alone for `bidder-only` (Cutthroat).
 */
function passThroughMelding(state: State, trump: Suit): State {
  const next = nextActivePhase(state.variant, 'Melding');
  if (next === null) {
    return state;
  }
  const table = getMeldTable(state.variant.melding.meldTableId);
  if (table === null) {
    return state;
  }
  const melds: SeatMeld[] = meldingSeats(state).map((seatIndex) => {
    const hand = state.private.hands[seatIndex]!;
    const { melds: seatMelds, total } = MeldDetector(hand, trump, table);
    return { seatIndex, melds: seatMelds, total };
  });
  const melded: State = { ...state, public: { ...state.public, phase: next, melds } };
  // For Partners, `Melding` passes straight through to `TrickPlay`; seed the
  // trick loop at the moment it becomes the resting phase (design D5). Cutthroat
  // rests at `Bury` first — its `Bury → TrickPlay` seeding is a later change.
  return next === 'TrickPlay' ? enterTrickPlay(melded) : melded;
}

/**
 * Seed the `TrickPlay` loop on entry (design D5): the bid winner (the recorded
 * contract seat) leads the first trick with a fresh empty `currentTrick`, and the
 * per-seat capture tally starts at zero for every dealt seat.
 */
function enterTrickPlay(state: State): State {
  const leader = state.public.contract?.seatIndex ?? 0;
  const captured: SeatCapture[] = state.private.hands.map((hand) => ({
    seatIndex: hand.seatIndex,
    counters: 0,
    tricksTaken: 0,
  }));
  return {
    ...state,
    public: { ...state.public, seatToAct: leader, currentTrick: makeTrick(), captured },
  };
}

/**
 * Drive a `playCard` during `TrickPlay` (design D5, D7). Rejected unchanged
 * unless the event seat is the seat-to-act, the referenced `CardRef` resolves by
 * identity to a card the seat holds, and that card is in the `LegalPlayValidator`
 * set. On acceptance: remove the card from the seat's hand, append it to the
 * current trick (setting the led suit on the first play), and pass the turn —
 * resolving the trick when one play per seat has landed.
 */
function applyPlayCard(state: State, event: PlayCardIntent): State {
  const { seatToAct, currentTrick, trump } = state.public;
  if (seatToAct === null || event.seat !== seatToAct || trump === null) {
    return state;
  }
  const hand = state.private.hands[event.seat];
  if (hand === undefined) {
    return state;
  }
  // Resolve the wire `CardRef` to a physical card by identity (copyIndex
  // disambiguates the two copies); reject if the seat does not hold it.
  const card = hand.cards.find((held) => cardsIdentical(held, event.card));
  if (card === undefined) {
    return state;
  }
  // Reject any card the legal set excludes.
  const legal = LegalPlayValidator(hand, currentTrick, trump, state.variant.trick);
  if (!legal.some((legalCard) => cardsIdentical(legalCard, card))) {
    return state;
  }

  const playerCount = state.variant.seating.playerCount;
  const hands = removeCard(state.private.hands, event.seat, card);
  const ledSuit = currentTrick.plays.length === 0 ? card.suit : currentTrick.ledSuit;
  const plays = [...currentTrick.plays, { seatIndex: event.seat, card }];
  const trick = makeTrick(ledSuit, plays, null);

  if (plays.length < playerCount) {
    // The trick continues: the next seat in order acts.
    const nextSeat = (event.seat + 1) % playerCount;
    return {
      ...state,
      public: { ...state.public, currentTrick: trick, seatToAct: nextSeat },
      private: { ...state.private, hands },
    };
  }
  return resolveCompletedTrick(state, trick, hands, trump);
}

/**
 * Resolve a completed trick (design D5): credit the winner its captured counters
 * (plus the `lastTrickBonus` when every hand is now empty) and a trick taken,
 * record the resolved trick, start a fresh `currentTrick`, and set the winner to
 * lead next — or, when the hand is complete, advance to `HandScoring`.
 */
function resolveCompletedTrick(
  state: State,
  trick: Trick,
  hands: readonly Hand[],
  trump: Suit,
): State {
  const winnerSeat = TrickResolver(trick, trump);
  const resolved = makeTrick(trick.ledSuit, trick.plays, winnerSeat);
  const handsEmpty = hands.every((hand) => hand.cards.length === 0);
  const bonus = handsEmpty ? state.variant.scoring.lastTrickBonus : 0;
  const counters = capturedCounters(trick, state.variant.scoring.counters) + bonus;
  const captured = creditCapture(state.public.captured, winnerSeat, counters);
  const completedTricks = [...state.public.completedTricks, resolved];

  const publicBase = {
    ...state.public,
    currentTrick: makeTrick(),
    completedTricks,
    captured,
  };
  if (handsEmpty) {
    // The final trick is resolved: advance along the legal edge to `HandScoring`.
    const next = nextActivePhase(state.variant, 'TrickPlay');
    const advanced: State = {
      ...state,
      public: { ...publicBase, phase: next ?? state.public.phase, seatToAct: null },
      private: { ...state.private, hands },
    };
    // `HandScoring` has no driving event (design D6): when it is the next active
    // phase, compute the hand score deterministically and rest there.
    return next === 'HandScoring' ? passThroughHandScoring(advanced) : advanced;
  }
  // The trick winner leads the next trick.
  return {
    ...state,
    public: { ...publicBase, seatToAct: winnerSeat },
    private: { ...state.private, hands },
  };
}

/**
 * Pass through the `HandScoring` phase deterministically (design D6): compute the
 * {@link HandScorer} result from the recorded melds, the per-seat capture tally,
 * the assembled {@link Contract}, and the variant, record it as `public.handResult`,
 * and append its per-side lines to the running `public.scorePad`. `buriedCounters`
 * is `0` on the Partners path (no Bury). `state` is the just-advanced state already
 * resting at `HandScoring`; the lifecycle does *not* advance toward `Dealing` /
 * `MatchComplete` (that branch is the `MatchScorer`'s).
 */
function passThroughHandScoring(state: State): State {
  const contract = getContract(state);
  if (contract === null) {
    return state;
  }
  const result = HandScorer(state.public.melds, state.public.captured, contract, 0, state.variant);
  return {
    ...state,
    public: {
      ...state.public,
      handResult: result,
      scorePad: appendHand(state.public.scorePad, result.lines),
    },
  };
}

/** Return new hands with `card` removed from `seat`'s hand; other hands untouched. */
function removeCard(hands: readonly Hand[], seat: number, card: Card): Hand[] {
  return hands.map((hand) =>
    hand.seatIndex === seat
      ? makeHand(
          seat,
          hand.cards.filter((held) => !cardsIdentical(held, card)),
        )
      : hand,
  );
}

/** Credit `seat`'s capture tally with `counters` points and one more trick taken. */
function creditCapture(
  captured: readonly SeatCapture[],
  seat: number,
  counters: number,
): SeatCapture[] {
  return captured.map((entry) =>
    entry.seatIndex === seat
      ? { ...entry, counters: entry.counters + counters, tricksTaken: entry.tricksTaken + 1 }
      : entry,
  );
}

/**
 * The seats that meld this hand, per `melding.whoMelds`: every dealt seat for
 * `all-seats`, the recorded contract seat alone for `bidder-only`.
 */
function meldingSeats(state: State): number[] {
  if (state.variant.melding.whoMelds === 'bidder-only') {
    const bidder = state.public.contract?.seatIndex;
    return bidder === undefined ? [] : [bidder];
  }
  return state.private.hands.map((hand) => hand.seatIndex);
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
