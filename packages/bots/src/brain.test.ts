import { describe, expect, it } from 'vitest';
import { SINGLE_DECK_PARTNERS } from '@meldrank/shared';
import { LegalPlayValidator, createInitialState, reduce, viewFor, type FilteredView, type State } from '@meldrank/engine';
import { brain } from './brain';
import type { BotContext, RandomSource } from './types';

/**
 * The bot brain is a pure, IO-free random-legal policy (spec `bot-decision-policy`).
 * These tests pin its contract across all three decision surfaces — bidding,
 * trump declaration, and trick play — using real engine states projected through
 * `viewFor`, so the brain is exercised against exactly the filtered view the room
 * would hand it. They assert: the returned intent is always engine-legal and for
 * the acting seat; the function is pure (same inputs + same randomness ⇒ same
 * intent); it decides only from filtered-view fields; and a forced single-legal
 * action is returned.
 */

const VARIANT = SINGLE_DECK_PARTNERS;

/** A randomness source that always returns the same value (e.g. 0 → first option). */
function constant(value: number): RandomSource {
  return () => value;
}

function ctxFor(seat: number, random: RandomSource): BotContext {
  return { seat, variant: VARIANT, difficulty: 'medium', random };
}

/** Deal a fresh Partners hand from a fixed seed, resting at `Auction`. */
function dealtHand(seed = 12345): State {
  return reduce(createInitialState(VARIANT, 0), { type: 'deal', seed });
}

/** Drive the auction so `bidderSeat` wins at the minimum and the rest pass, resting at `DeclareTrump`. */
function wonAuction(bidderSeat: number): State {
  let state = dealtHand();
  // The auction opens left of the dealer (seat 1) and runs clockwise; the bidder
  // bids the minimum on its turn, everyone else passes.
  for (let guard = 0; guard < 16; guard++) {
    const seat = state.public.seatToAct;
    if (state.public.phase !== 'Auction' || seat === null) {
      break;
    }
    const intent =
      seat === bidderSeat && state.public.contract === null && state.public.auction!.highBid === null
        ? ({ type: 'bid', seat, value: VARIANT.bidding.minimumBid } as const)
        : ({ type: 'pass', seat } as const);
    state = reduce(state, intent);
  }
  return state;
}

/** Drive past trump declaration into `TrickPlay`, with `bidderSeat` leading the first trick. */
function inTrickPlay(bidderSeat: number, trump = VARIANT.deck.suits[0]!): State {
  return reduce(wonAuction(bidderSeat), { type: 'declareTrump', seat: bidderSeat, trump });
}

describe('brain — acting seat and purity', () => {
  it('returns an intent for the acting seat', () => {
    const state = dealtHand();
    const seat = state.public.seatToAct!;
    const intent = brain(viewFor(state, seat), ctxFor(seat, constant(0)));
    expect(intent.seat).toBe(seat);
  });

  it('is pure: identical inputs and randomness yield the same intent', () => {
    const state = inTrickPlay(1);
    const seat = state.public.seatToAct!;
    const view = viewFor(state, seat);
    const a = brain(view, ctxFor(seat, constant(0.42)));
    const b = brain(view, ctxFor(seat, constant(0.42)));
    expect(a).toEqual(b);
  });

  it('rejects a view whose viewer does not match the acting seat', () => {
    const state = dealtHand();
    const seat = state.public.seatToAct!;
    const otherSeat = (seat + 1) % VARIANT.seating.playerCount;
    expect(() => brain(viewFor(state, seat), ctxFor(otherSeat, constant(0)))).toThrow();
  });
});

describe('brain — bidding surface', () => {
  it('returns a legal pass or bid per the engine options', () => {
    const state = dealtHand();
    const seat = state.public.seatToAct!;
    const view = viewFor(state, seat);

    // random → 0 selects the first candidate (pass); → 0.99 selects the floor bid.
    const passed = brain(view, ctxFor(seat, constant(0)));
    expect(passed).toEqual({ type: 'pass', seat });

    const bid = brain(view, ctxFor(seat, constant(0.99)));
    expect(bid).toEqual({ type: 'bid', seat, value: VARIANT.bidding.minimumBid });

    // Both options the brain offered must be accepted by the engine reducer.
    for (const intent of [passed, bid]) {
      expect(reduce(state, intent)).not.toBe(state);
    }
  });
});

describe('brain — trump declaration surface', () => {
  it('names a legal trump when it holds the contract', () => {
    const state = wonAuction(1);
    expect(state.public.phase).toBe('DeclareTrump');
    expect(state.public.contract!.seatIndex).toBe(1);

    const intent = brain(viewFor(state, 1), ctxFor(1, constant(0.5)));
    expect(intent.type).toBe('declareTrump');
    expect(intent.seat).toBe(1);
    expect(VARIANT.deck.suits).toContain(intent.type === 'declareTrump' ? intent.trump : null);
    // The engine accepts the declaration (the phase advances out of DeclareTrump).
    expect(reduce(state, intent).public.phase).not.toBe('DeclareTrump');
  });
});

describe('brain — trick play surface', () => {
  it('plays a legal card drawn only from its own filtered hand', () => {
    const state = inTrickPlay(1);
    const seat = state.public.seatToAct!;
    const view = viewFor(state, seat);
    const ownKeys = new Set(view.own!.hand.map((c) => `${c.rank}-${c.suit}-${c.copyIndex}`));

    const intent = brain(view, ctxFor(seat, constant(0.3)));
    expect(intent.type).toBe('playCard');
    expect(intent.seat).toBe(seat);
    const card = intent.type === 'playCard' ? intent.card : null;
    // The chosen card is one the seat actually holds (no hidden-info reference)…
    expect(ownKeys.has(`${card!.rank}-${card!.suit}-${card!.copyIndex}`)).toBe(true);
    // …and it is one the engine's own legal-play set permits.
    const legal = LegalPlayValidator(
      { seatIndex: seat, cards: view.own!.hand },
      view.public.currentTrick,
      view.public.trump!,
      VARIANT.trick,
    );
    expect(legal.some((c) => c.rank === card!.rank && c.suit === card!.suit && c.copyIndex === card!.copyIndex)).toBe(true);
    // The engine accepts the play.
    expect(reduce(state, intent)).not.toBe(state);
  });

  it('returns the only legal action when one is forced', () => {
    const state = inTrickPlay(1);
    const seat = state.public.seatToAct!;
    const realView = viewFor(state, seat);
    // Force the case: a single-card hand as leader has exactly one legal play.
    const oneCard = realView.own!.hand[0]!;
    const forcedView: FilteredView = { ...realView, own: { hand: [oneCard], buried: [] } };

    // Regardless of the randomness, the single legal card is returned.
    for (const r of [0, 0.5, 0.99]) {
      const intent = brain(forcedView, ctxFor(seat, constant(r)));
      expect(intent.type).toBe('playCard');
      const card = intent.type === 'playCard' ? intent.card : null;
      expect(card).toEqual({ rank: oneCard.rank, suit: oneCard.suit, copyIndex: oneCard.copyIndex });
    }
  });
});
