import type { DeclareTrumpIntent, PlayCardIntent, Suit, VariantDefinition, BuryIntent } from '@meldrank/shared';
import { getMeldTable } from '@meldrank/shared/meld';
import { isLegalTransition, resolveActivePath, type LifecyclePhase } from '../lifecycle/phases';
import { createSeededRng } from '../dealer/rng';
import { deal } from '../dealer/deal';
import { applyBid, applyPass, openAuction, type AuctionStep } from '../auction/auction';
import { revealWidow } from '../widow/widow';
import { declareTrump } from '../declare/declare';
import { MeldDetector } from '../meld/meld';
import { buryableCards } from '../bury/bury';
import { LegalPlayValidator, TrickResolver, capturedCounters } from '../play';
import { HandScorer } from '../score/score';
import { MatchScorer } from '../match/match';
import { TimeoutMove } from '../timeout/timeout';
import { cardIdentityKey, cardsIdentical, type Card } from '../domain/card';
import { appendHand, makeHand, makeTrick, type Hand, type Trick } from '../domain/entities';
import { createInitialState, getContract, type SeatCapture, type SeatMeld, type State } from './state';
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
 * The `timeout` system event is resolved uniformly up front through `TimeoutMove`
 * (design D4): when it names the seat-to-act, `reduce` computes the deterministic
 * forced intent (a `pass` where passing is legal, the lowest-value legal card in
 * `TrickPlay`, `null` elsewhere) and re-enters with it, so the forced move passes
 * the same guards a human move does; a timeout for any other seat, or in a phase
 * with no forced move, leaves the state unchanged. This is the single place that
 * resolves a timeout — no phase branch handles it inline.
 *
 * This change drives the full `Dealing → Auction → [WidowReveal] → DeclareTrump →
 * Melding → [Bury] → TrickPlay → HandScoring` lifecycle: a `deal` populates the
 * hands and widow and opens the auction; `bid`/`pass` drive the auction
 * to a recorded `Bid` (and, for widow variants, a deterministic widow reveal)
 * resting at `DeclareTrump`, or a `redeal` outcome; a `declareTrump` from the
 * contract winner records the trump and computes each melding seat's meld through
 * the deterministic `Melding` transition. For a bury-enabled variant (Cutthroat),
 * `Melding` then **rests** at `Bury` with the bidder on the clock, and a legal
 * `bury` from the bidder (exactly `dealing.bury.size` distinct, held, eligible
 * cards) discards those cards into `private.buried` and advances to a seeded
 * `TrickPlay`; an illegal bury is a no-op. (Partners skips `Bury` and seeds
 * `TrickPlay` straight out of `Melding`.) `TrickPlay` then **rests** and folds
 * repeated `playCard` intents: each is validated against the `LegalPlayValidator`
 * and the seat-to-act, appended to the current trick, and on a complete trick the
 * winner (`TrickResolver`) is credited its captured counters and leads next —
 * looping until hands empty, then advancing to `HandScoring`. At `HandScoring` the
 * hand is scored (buried counters credited to the bidding side), the
 * hands-made-as-bidder counter updated, and `MatchScorer` evaluates the match-end
 * condition: if the match is over, `reduce` advances to a terminal `MatchComplete`
 * carrying the `MatchResult`; otherwise it rests at `HandScoring` and a `deal`
 * starts the next hand (dealer rotated, per-hand state reset, score pad and
 * match-scope counters preserved). `MatchComplete` rejects every event.
 */
export function reduce(state: State, event: Event): State {
  // Single resolution point for the `timeout` system event (design D4): when it
  // names the seat-to-act, resolve the forced intent via `TimeoutMove` and re-enter
  // `reduce` with it, so the forced move passes the identical phase/turn/legality
  // guards a human move does. A timeout for any other seat — or a phase with no
  // forced move (`TimeoutMove` returns `null`) — leaves the state unchanged. The
  // forced intent is never itself a `timeout`, so this recurs at most one level.
  if (event.type === 'timeout') {
    const forced = event.seat === state.public.seatToAct ? TimeoutMove(state) : null;
    return forced === null ? state : reduce(state, forced);
  }
  switch (state.public.phase) {
    case 'Dealing':
      return event.type === 'deal' ? applyDeal(state, event) : state;
    case 'Auction':
      return applyAuctionEvent(state, event);
    case 'DeclareTrump':
      return event.type === 'declareTrump' ? applyDeclareTrump(state, event) : state;
    case 'Bury':
      return event.type === 'bury' ? applyBury(state, event) : state;
    case 'TrickPlay':
      return event.type === 'playCard' ? applyPlayCard(state, event) : state;
    case 'HandScoring':
      // The match is provably not over here (over ⇒ `MatchComplete`), so a `deal`
      // starts the next hand (design D5/D6); every other event is rejected.
      return event.type === 'deal' ? startNextHand(state, event) : state;
    default:
      // `MatchComplete` is terminal; every event is rejected without mutation.
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
  const { hands, widow } = deal(variant.deck, variant.dealing.handSize, variant.dealing.widow.size, rng);
  const auction = openAuction(variant.seating.playerCount, state.public.dealerSeat);

  return {
    variant,
    public: { ...state.public, phase: next, seatToAct: auction.toAct, auction },
    private: { hands, widow, buried: [] },
  };
}

/**
 * Route an Auction-phase event to the auction module. A `timeout` never reaches
 * here — `reduce` resolves it to a forced `pass` up front (design D4) — so this
 * sees only the real `bid`/`pass` intents.
 */
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
    private: { ...state.private, hands: revealed.hands, widow: revealed.widow },
  };
}

/**
 * Drive a `declareTrump` during `DeclareTrump`: legal only from the contract
 * winner naming one of the active deck's suits (design D3). A legal declaration
 * records `public.trump` and advances to the variant's next active phase
 * (`Melding`); an illegal one leaves the state unchanged.
 */
function applyDeclareTrump(state: State, event: DeclareTrumpIntent): State {
  const step = declareTrump(state.public.contract, state.variant.deck.suits, event.seat, event.trump);
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
  // For Partners, `Melding` passes straight through to `TrickPlay`, so the trick
  // loop is seeded the moment it becomes the resting phase (design D5). For a
  // bury-enabled variant (Cutthroat) it rests at `Bury` with the **bidder** (the
  // recorded contract seat) set to act, so the bidder is on the clock to choose
  // the bury (design D4).
  if (next === 'TrickPlay') {
    return enterTrickPlay({ ...state, public: { ...state.public, phase: next, melds } });
  }
  const bidder = state.public.contract?.seatIndex ?? null;
  return { ...state, public: { ...state.public, phase: next, melds, seatToAct: bidder } };
}

/**
 * Drive a `bury` during `Bury` (design D2, D4). Rejected unchanged unless the
 * event seat is the bidder (the recorded contract seat) and the seat-to-act, every
 * referenced `CardRef` resolves by identity to a card the bidder holds, and the
 * proposed bury is legal: exactly `dealing.bury.size` cards, all distinct, and all
 * members of the `buryableCards` set (the variant's `no-melded` / `no-trump` /
 * `no-dix` restrictions). On acceptance: remove the buried cards from the bidder's
 * hand into `private.buried`, advance along the legal `Bury → TrickPlay` edge, and
 * seed the trick loop with the bidder leading (`enterTrickPlay`).
 */
function applyBury(state: State, event: BuryIntent): State {
  const { seatToAct, contract, trump, melds } = state.public;
  const bidder = contract?.seatIndex;
  if (bidder === undefined || event.seat !== bidder || seatToAct !== bidder || trump === null) {
    return state;
  }
  const hand = state.private.hands[bidder];
  if (hand === undefined) {
    return state;
  }

  // Resolve each proposed `CardRef` to a held card by identity (`copyIndex`
  // disambiguates the two copies); reject if any is not held.
  const resolved: Card[] = [];
  for (const ref of event.cards) {
    const held = hand.cards.find((card) => cardsIdentical(card, ref));
    if (held === undefined) {
      return state;
    }
    resolved.push(held);
  }

  // The bury must name exactly `bury.size` distinct cards.
  const size = state.variant.dealing.bury.size;
  if (resolved.length !== size) {
    return state;
  }
  const distinct = new Set(resolved.map((card) => cardIdentityKey(card)));
  if (distinct.size !== resolved.length) {
    return state;
  }

  // Every named card must be eligible (in the bury-validator's set).
  const bidderMelds = melds.find((seatMeld) => seatMeld.seatIndex === bidder)?.melds ?? [];
  const eligible = buryableCards(hand, bidderMelds, trump, state.variant.dealing.bury.restrictions);
  if (!resolved.every((card) => eligible.some((ok) => cardsIdentical(ok, card)))) {
    return state;
  }

  // Accept: remove the buried cards from the bidder's hand, record the bury pile,
  // advance to `TrickPlay`, and seed the trick loop with the bidder leading.
  const next = nextActivePhase(state.variant, 'Bury');
  if (next === null) {
    return state;
  }
  const remaining = hand.cards.filter((card) => !resolved.some((buried) => cardsIdentical(buried, card)));
  const hands = state.private.hands.map((seatHand) => (seatHand.seatIndex === bidder ? makeHand(bidder, remaining) : seatHand));
  const buried: State = {
    ...state,
    public: { ...state.public, phase: next },
    private: { ...state.private, hands, buried: resolved },
  };
  return next === 'TrickPlay' ? enterTrickPlay(buried) : buried;
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
function resolveCompletedTrick(state: State, trick: Trick, hands: readonly Hand[], trump: Suit): State {
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
 * Pass through the `HandScoring` phase deterministically (design D5/D6): compute the
 * {@link HandScorer} result from the recorded melds, the per-seat capture tally,
 * the assembled {@link Contract}, and the variant, record it as `public.handResult`,
 * append its per-side lines to the running `public.scorePad`, and update the
 * match-scope hands-made-as-bidder counter (incremented for the bidding side when
 * the hand was made). `buriedCounters` is the summed counter value of the bidder's
 * bury pile (design D5), credited to the bidding side; it is `0` on the Partners
 * path (no Bury, so the pile is empty).
 * Then evaluate the match-end condition via {@link MatchScorer}: if the match is
 * over, advance along the legal `HandScoring → MatchComplete` edge, record the
 * `MatchResult`, clear the seat-to-act, and rest terminally; otherwise rest at
 * `HandScoring` awaiting the next `deal`. `state` is the just-advanced state already
 * resting at `HandScoring`.
 */
function passThroughHandScoring(state: State): State {
  const contract = getContract(state);
  if (contract === null) {
    return state;
  }
  // Sum the buried cards' counter values (§9): credited to the bidding side at
  // scoring (design D5). The Partners path has an empty bury pile, so this is `0`.
  const counters = state.variant.scoring.counters;
  const buriedCounters = state.private.buried.reduce((sum, card) => sum + counters[card.rank], 0);
  const result = HandScorer(state.public.melds, state.public.captured, contract, buriedCounters, state.variant);
  const scorePad = appendHand(state.public.scorePad, result.lines);
  const prior = state.public.handsMadeAsBidder;
  const handsMadeAsBidder = result.made ? { ...prior, [result.side]: (prior[result.side] ?? 0) + 1 } : prior;

  const scored = { ...state.public, handResult: result, scorePad, handsMadeAsBidder };
  const matchResult = MatchScorer(scorePad, result, handsMadeAsBidder, state.variant);
  if (matchResult.complete && isLegalTransition('HandScoring', 'MatchComplete')) {
    return {
      ...state,
      public: { ...scored, phase: 'MatchComplete', matchResult, seatToAct: null },
    };
  }
  return { ...state, public: scored };
}

/**
 * Start the next hand of the match from a resting `HandScoring` (design D5). Build
 * a fresh next-hand base via {@link createInitialState} (every per-hand public and
 * private field reset to its `Dealing` default) with the dealer rotated one seat,
 * **preserving** the running `scorePad` and the match-scope `handsMadeAsBidder`
 * counter, then run the standard {@link applyDeal} to deal the hands/widow and open
 * the auction (landing at `Auction`). The match is provably not over here, so the
 * deal is always valid.
 */
function startNextHand(state: State, event: DealEvent): State {
  const { variant } = state;
  const nextDealer = (state.public.dealerSeat + 1) % variant.seating.playerCount;
  const base = createInitialState(variant, nextDealer);
  const freshBase: State = {
    ...base,
    public: {
      ...base.public,
      scorePad: state.public.scorePad,
      handsMadeAsBidder: state.public.handsMadeAsBidder,
    },
  };
  return applyDeal(freshBase, event);
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
function creditCapture(captured: readonly SeatCapture[], seat: number, counters: number): SeatCapture[] {
  return captured.map((entry) =>
    entry.seatIndex === seat ? { ...entry, counters: entry.counters + counters, tricksTaken: entry.tricksTaken + 1 } : entry,
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
