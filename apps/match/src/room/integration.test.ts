import { describe, expect, it } from 'vitest';
import { SINGLE_DECK_PARTNERS, type VariantDefinition } from '@meldrank/shared';
import { LegalPlayValidator, type State } from '@meldrank/engine';
import { createRoomCore, disposeRoom, joinRoom, submitContribution, submitIntent } from './core';
import type { Effect, PlayerIntent, RoomCoreState, ServerSeedSource, StepResult } from './types';

/**
 * End-to-end: boot `RoomCore` in-process, fill the seats, run the provably-fair
 * handshake, and play a full hand to `HandScoring` over the authoritative intent
 * loop — asserting no hidden information leaks into any seat's view (task 6.1), and
 * that `Persisted` is an inert transition (task 6.2).
 */

function fixedSeeder(start = 1): ServerSeedSource {
  let n = start;
  return () => {
    const bytes = new Uint8Array(32);
    bytes[0] = n & 0xff;
    bytes[1] = (n >> 8) & 0xff;
    n += 1;
    return bytes;
  };
}

function clientSeed(seat: number): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes[0] = 200 + seat;
  return bytes;
}

function connFor(state: RoomCoreState, seat: number): string {
  return state.seats.find((s) => s.seatIndex === seat)!.connectionId;
}

/** Fill every seat and run the handshake so a hand is dealt; returns the dealt
 *  state plus the effects from the deal broadcast. */
function bootAndDeal(variant: VariantDefinition, seed: ServerSeedSource): { state: RoomCoreState; dealEffects: readonly Effect[] } {
  let state = createRoomCore(variant);
  const count = variant.seating.playerCount;
  for (let i = 0; i < count; i++) state = joinRoom(state, `conn-${i}`, seed).state;
  let dealEffects: readonly Effect[] = [];
  for (let i = 0; i < count; i++) {
    const step = submitContribution(state, `conn-${i}`, clientSeed(i));
    state = step.state;
    if (step.effects.length > 0) dealEffects = step.effects;
  }
  return { state, dealEffects };
}

/** Recursively collect every card-identity key reachable in a value. */
function cardKeys(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (value === null || typeof value !== 'object') {
    return into;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.rank === 'string' && typeof record.suit === 'string' && typeof record.copyIndex === 'number') {
    into.add(`${record.rank}-${record.suit}-${record.copyIndex}`);
  }
  for (const child of Object.values(record)) {
    cardKeys(child, into);
  }
  return into;
}

/** The set of card keys that are hidden from `viewerSeat`: every other seat's held
 *  cards, the unrevealed widow, and the (non-viewer) buried pile. */
function hiddenFrom(engine: State, viewerSeat: number): Set<string> {
  const keys = new Set<string>();
  engine.private.hands.forEach((hand) => {
    if (hand.seatIndex !== viewerSeat) hand.cards.forEach((c) => keys.add(`${c.rank}-${c.suit}-${c.copyIndex}`));
  });
  for (const card of engine.private.widow) keys.add(`${card.rank}-${card.suit}-${card.copyIndex}`);
  return keys;
}

/** Drive one hand through auction → declare → trick play. The first auction actor
 *  bids the minimum; everyone else passes; the bidder declares; play follows the
 *  first legal card each turn. Stops when the room deals the next hand or completes. */
function playOneHand(start: RoomCoreState, seed: ServerSeedSource, variant: VariantDefinition): { state: RoomCoreState; last: StepResult } {
  let state = start;
  let bidPlaced = false;
  let last: StepResult = { state, effects: [] };
  for (let guard = 0; guard < 1000; guard++) {
    const engine = state.engine;
    if (engine === null) break;
    const phase = engine.public.phase;
    if (phase !== 'Auction' && phase !== 'DeclareTrump' && phase !== 'TrickPlay') break;

    let actorSeat: number;
    let intent: PlayerIntent;
    if (phase === 'Auction') {
      actorSeat = engine.public.seatToAct!;
      if (!bidPlaced) {
        intent = { type: 'bid', seat: actorSeat, value: variant.bidding.minimumBid };
        bidPlaced = true;
      } else {
        intent = { type: 'pass', seat: actorSeat };
      }
    } else if (phase === 'DeclareTrump') {
      actorSeat = engine.public.contract!.seatIndex;
      intent = { type: 'declareTrump', seat: actorSeat, trump: variant.deck.suits[0]! };
    } else {
      actorSeat = engine.public.seatToAct!;
      const hand = engine.private.hands[actorSeat]!;
      const legal = LegalPlayValidator(hand, engine.public.currentTrick, engine.public.trump!, variant.trick);
      const card = legal[0]!;
      intent = { type: 'playCard', seat: actorSeat, card: { rank: card.rank, suit: card.suit, copyIndex: card.copyIndex } };
    }

    const step = submitIntent(state, connFor(state, actorSeat), intent, `c-${guard}`, seed);
    expect(step.state).not.toBe(state); // every driven move must make progress
    last = step;
    state = step.state;
  }
  return { state, last };
}

describe('match room — end to end', () => {
  it('deals via the handshake with no hidden information in any seat view', () => {
    const { state, dealEffects } = bootAndDeal(SINGLE_DECK_PARTNERS, fixedSeeder());
    const engine = state.engine!;
    const views = dealEffects.filter((e): e is Extract<Effect, { kind: 'view' }> => e.kind === 'view');
    expect(views).toHaveLength(SINGLE_DECK_PARTNERS.seating.playerCount);

    for (const { view } of views) {
      const seat = view.viewer!;
      // The view exposes only this seat's own hand…
      expect(view.own).not.toBeNull();
      const ownKeys = cardKeys(view.own!.hand);
      const engineHandKeys = cardKeys(engine.private.hands[seat]!.cards);
      expect(ownKeys).toEqual(engineHandKeys);
      // …carries every seat's hand *size* but no other seat's card identities…
      expect(view.handSizes).toEqual(engine.private.hands.map((h) => h.cards.length));
      const present = cardKeys(view);
      for (const hidden of hiddenFrom(engine, seat)) {
        expect(present.has(hidden)).toBe(false);
      }
    }
  });

  it('plays a full hand to scoring then deals the next hand', () => {
    const seed = fixedSeeder();
    const { state } = bootAndDeal(SINGLE_DECK_PARTNERS, seed);
    const { state: after, last } = playOneHand(state, seed, SINGLE_DECK_PARTNERS);

    // The hand reached HandScoring — the broadcast from the final play carries the
    // scored result — and, the match not being over, the next hand was dealt.
    const scoredView = last.effects.map((e) => ('view' in e ? e.view : undefined)).find((v) => v?.public.handResult != null);
    expect(scoredView).toBeDefined();
    expect(after.lifecycle).toBe('Live');
    expect(after.engine!.public.phase).toBe('Dealing');
    expect(after.handsDealt).toBe(2);
    expect(after.handshake).not.toBeNull();
  });

  it('completes the match, runs through the inert Persisted transition, then disposes', () => {
    // A target-score of 1 guarantees the match ends after the first hand.
    const variant: VariantDefinition = { ...SINGLE_DECK_PARTNERS, matchEnd: { mode: 'target-score', target: 1 } };
    const seed = fixedSeeder();
    const { state } = bootAndDeal(variant, seed);
    const { state: after, last } = playOneHand(state, seed, variant);

    // Live → Complete → Persisted. Persisted is inert: it writes nothing durable
    // (the room module imports no database), and the engine state is retained until
    // disposal so the final broadcast views stay valid.
    expect(after.lifecycle).toBe('Persisted');
    expect(after.engine).not.toBeNull();
    expect(after.engine!.public.matchResult?.complete).toBe(true);
    const finalView = last.effects.map((e) => ('view' in e ? e.view : undefined)).find((v) => v?.public.matchResult != null);
    expect(finalView).toBeDefined();

    // Disposal releases the engine and is the only step that tears the room down.
    const disposed = disposeRoom(after).state;
    expect(disposed.lifecycle).toBe('Disposed');
    expect(disposed.engine).toBeNull();
  });
});
