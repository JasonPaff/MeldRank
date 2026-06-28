import { LegalPlayValidator, applyBid, applyPass, declareTrump, type FilteredView } from '@meldrank/engine';
import type { PlayerIntent } from '@meldrank/shared';
import type { BotContext, RandomSource } from './types';

/**
 * The v1 bot brain (spec `bot-decision-policy`): a pure, IO-free
 * `brain(view, ctx) → PlayerIntent` implementing a **random-legal** policy. At
 * every decision surface — bidding (bid/pass), trump declaration, and trick play —
 * it enumerates the moves the engine permits *from the seat's filtered view* (the
 * same legality the engine enforces everywhere) and selects one uniformly through
 * the injected randomness. It decides only from the view's own hand and public
 * state, never hidden information, so a bot is exactly as informed as a human in
 * the same seat. It makes no meld decision (meld is engine-computed).
 *
 * Because every returned intent is drawn from the engine-legal set, the room never
 * rejects a bot's intent under normal operation — the legality contract holds by
 * construction. A future heuristic brain replaces the selection step behind this
 * identical signature (the difficulty seam in {@link BotContext}); v1 ignores it.
 */
export function brain(view: FilteredView, ctx: BotContext): PlayerIntent {
  if (view.viewer !== ctx.seat) {
    throw new Error(`bot brain: view for seat ${String(view.viewer)} does not match acting seat ${ctx.seat}`);
  }
  const legal = enumerateLegalIntents(view, ctx);
  if (legal.length === 0) {
    throw new Error(`bot brain: no legal move for seat ${ctx.seat} in phase ${view.public.phase}`);
  }
  return pick(legal, ctx.random);
}

/**
 * Enumerate the engine-legal intents for the acting seat at the current decision
 * surface, derived purely from the filtered view. Each candidate is checked against
 * the engine's own legality functions, so the returned set is exactly the moves the
 * room would accept — empty only when it is not this seat's decision (the adapter
 * never calls the brain in that case).
 */
function enumerateLegalIntents(view: FilteredView, ctx: BotContext): PlayerIntent[] {
  switch (view.public.phase) {
    case 'Auction':
      return legalAuctionIntents(view, ctx);
    case 'DeclareTrump':
      return legalDeclareTrumpIntents(view, ctx);
    case 'TrickPlay':
      return legalPlayIntents(view, ctx);
    default:
      // Bury and the deterministic/terminal phases are outside the v1 brain's
      // decision surfaces (Bots & AI — Design v1 §6, Partners-first). The adapter
      // never drives a bot in those phases on the Partners path.
      return [];
  }
}

/**
 * The legal auction moves: a `pass` (always legal for the live seat to act) and a
 * `bid` at the current floor (`highBid + increment`, else `minimumBid`). The floor
 * bid is the minimal legal raise — keeping bots' auctions bounded — and both are
 * verified through the engine's auction module before being offered.
 */
function legalAuctionIntents(view: FilteredView, ctx: BotContext): PlayerIntent[] {
  const auction = view.public.auction;
  if (auction === null) {
    return [];
  }
  const params = {
    minimumBid: ctx.variant.bidding.minimumBid,
    increment: ctx.variant.bidding.increment,
    allPassRule: ctx.variant.bidding.allPassRule,
  };
  const floor = auction.highBid ? auction.highBid.value + params.increment : params.minimumBid;
  const candidates: PlayerIntent[] = [
    { type: 'pass', seat: ctx.seat },
    { type: 'bid', seat: ctx.seat, value: floor },
  ];
  return candidates.filter((intent) => {
    if (intent.type === 'bid') {
      return applyBid(auction, params, intent.seat, intent.value).status !== 'rejected';
    }
    return applyPass(auction, params, view.public.dealerSeat, intent.seat).status !== 'rejected';
  });
}

/**
 * The legal trump declarations: one per suit in the active deck, each validated
 * through the engine's `declareTrump` (legal only from the contract winner naming a
 * real deck suit). The brain reaches this surface only when it holds the contract.
 */
function legalDeclareTrumpIntents(view: FilteredView, ctx: BotContext): PlayerIntent[] {
  const { contract } = view.public;
  const candidates: PlayerIntent[] = ctx.variant.deck.suits.map((trump) => ({ type: 'declareTrump', seat: ctx.seat, trump }));
  return candidates.filter(
    (intent) =>
      intent.type === 'declareTrump' && declareTrump(contract, ctx.variant.deck.suits, intent.seat, intent.trump).status !== 'rejected',
  );
}

/**
 * The legal trick plays: every card the `LegalPlayValidator` permits from the
 * seat's own hand against the in-progress trick and the declared trump (follow-suit
 * / must-trump / must-beat per the variant). Always non-empty for a non-empty hand.
 */
function legalPlayIntents(view: FilteredView, ctx: BotContext): PlayerIntent[] {
  const { trump, currentTrick } = view.public;
  if (trump === null || view.own === null) {
    return [];
  }
  const hand = { seatIndex: ctx.seat, cards: view.own.hand };
  const legalCards = LegalPlayValidator(hand, currentTrick, trump, ctx.variant.trick);
  return legalCards.map((card) => ({
    type: 'playCard',
    seat: ctx.seat,
    card: { rank: card.rank, suit: card.suit, copyIndex: card.copyIndex },
  }));
}

/** Pick one element uniformly using the injected randomness source (clamped for safety). */
function pick<T>(items: readonly T[], random: RandomSource): T {
  const index = Math.min(items.length - 1, Math.max(0, Math.floor(random() * items.length)));
  return items[index]!;
}
