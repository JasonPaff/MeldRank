import { describe, expect, it } from 'vitest';
import { SINGLE_DECK_PARTNERS, type VariantDefinition } from '@meldrank/shared';
import { LegalPlayValidator, type State } from '@meldrank/engine';
import { createRoomCore, disposeRoom, expireClock, joinRoom, markPersisted, submitContribution, submitIntent } from './core';
import { DEFAULT_CLOCK_CONFIG } from './clock';
import type { Clock, Effect, PlayerIntent, RoomCoreState, ServerSeedSource, StepResult } from './types';

/**
 * End-to-end: boot `RoomCore` in-process, fill the seats, run the provably-fair
 * handshake, and play a full hand to `HandScoring` over the authoritative intent
 * loop — asserting no hidden information leaks into any seat's view, and that a
 * completed match rests at `Complete` emitting a `persist` effect (capability
 * `match-persistence`), reaching `Persisted` only via `markPersisted`.
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

/** A fixed clock anchored at 0; the deal stamps the first turn at t = 0. */
const clock: Clock = () => 0;

/** A clock far past any deadline, to force a clock expiry on demand. */
const expiredClock: Clock = () => 1_000_000;

/** Fill every seat and run the handshake so a hand is dealt; returns the dealt
 *  state plus the effects from the deal broadcast. */
function bootAndDeal(variant: VariantDefinition, seed: ServerSeedSource): { state: RoomCoreState; dealEffects: readonly Effect[] } {
  let state = createRoomCore(variant);
  const count = variant.seating.playerCount;
  for (let i = 0; i < count; i++) state = joinRoom(state, `conn-${i}`, seed, clock).state;
  let dealEffects: readonly Effect[] = [];
  for (let i = 0; i < count; i++) {
    const step = submitContribution(state, `conn-${i}`, clientSeed(i), clock);
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

    const step = submitIntent(state, connFor(state, actorSeat), intent, `c-${guard}`, seed, clock);
    expect(step.state).not.toBe(state); // every driven move must make progress
    last = step;
    state = step.state;
  }
  return { state, last };
}

/** Drive auction + declare so the room rests at `TrickPlay` with a seat on the clock. */
function driveToTrickPlay(start: RoomCoreState, seed: ServerSeedSource, variant: VariantDefinition): RoomCoreState {
  let state = start;
  let bidPlaced = false;
  for (let guard = 0; guard < 1000; guard++) {
    const engine = state.engine!;
    const phase = engine.public.phase;
    if (phase === 'TrickPlay') {
      return state;
    }
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
      break;
    }
    state = submitIntent(state, connFor(state, actorSeat), intent, `t-${guard}`, seed, clock).state;
  }
  return state;
}

describe('clock expiry → engine timeout policy', () => {
  const playerCount = SINGLE_DECK_PARTNERS.seating.playerCount;

  it('auction timeout forces a pass through the same advance/broadcast loop', () => {
    const seed = fixedSeeder();
    const { state } = bootAndDeal(SINGLE_DECK_PARTNERS, seed);
    expect(state.engine!.public.phase).toBe('Auction');
    const actor = state.engine!.public.seatToAct!;

    const result = expireClock(state, expiredClock, seed);

    // The engine advanced (a forced pass was applied) and the turn moved on.
    expect(result.state.engine).not.toBe(state.engine);
    expect(result.state.engine!.public.seatToAct).not.toBe(actor);
    // A pass records no contract — confirming it was a pass, not a bid.
    expect(result.state.engine!.public.contract).toBeNull();
    // The timed-out seat's banks are fully spent.
    const timedOut = result.state.seats.find((s) => s.seatIndex === actor)!;
    expect(timedOut.remainingBaseMs).toBe(0);
    expect(timedOut.remainingReserveMs).toBe(0);
    expect(timedOut.timeoutCount).toBe(1);
    // Same per-recipient broadcast path as a player move: one view per seat.
    expect(result.effects.filter((e) => e.kind === 'view')).toHaveLength(playerCount);
  });

  it('trick-play timeout auto-plays a legal card through the same loop', () => {
    const seed = fixedSeeder();
    const { state } = bootAndDeal(SINGLE_DECK_PARTNERS, seed);
    const inTrickPlay = driveToTrickPlay(state, seed, SINGLE_DECK_PARTNERS);
    expect(inTrickPlay.engine!.public.phase).toBe('TrickPlay');
    const actor = inTrickPlay.engine!.public.seatToAct!;
    const handBefore = inTrickPlay.engine!.private.hands[actor]!.cards.length;

    const result = expireClock(inTrickPlay, expiredClock, seed);

    // A card was forced: the acting seat's hand shrank by exactly one.
    expect(result.state.engine!.private.hands[actor]!.cards.length).toBe(handBefore - 1);
    const timedOut = result.state.seats.find((s) => s.seatIndex === actor)!;
    expect(timedOut.remainingBaseMs).toBe(0);
    expect(timedOut.remainingReserveMs).toBe(0);
    // Forced move uses the identical per-recipient broadcast: each seat gets its own view.
    const views = result.effects.filter((e): e is Extract<Effect, { kind: 'view' }> => e.kind === 'view');
    expect(views).toHaveLength(playerCount);
    const ownHands = views.map((v) => JSON.stringify(v.view.own?.hand ?? []));
    expect(new Set(ownHands).size).toBe(ownHands.length); // distinct per seat
  });

  it('is a no-op when the deadline has not yet passed', () => {
    const seed = fixedSeeder();
    const { state } = bootAndDeal(SINGLE_DECK_PARTNERS, seed);
    // turnStartedAt = 0 and base+reserve unspent → deadline is well in the future.
    const early = expireClock(state, () => 1, seed);
    expect(early.state).toBe(state);
    expect(early.effects).toHaveLength(0);
  });

  /** Boot a ranked/casual room with a given abandonment threshold, dealt to Auction. */
  function bootRanked(seed: ServerSeedSource, ranked: boolean, threshold: number): RoomCoreState {
    let state = createRoomCore(SINGLE_DECK_PARTNERS, { ranked, clock: { ...DEFAULT_CLOCK_CONFIG, timeoutAbandonThreshold: threshold } });
    for (let i = 0; i < playerCount; i++) state = joinRoom(state, `conn-${i}`, seed, clock).state;
    for (let i = 0; i < playerCount; i++) state = submitContribution(state, `conn-${i}`, clientSeed(i), clock).state;
    return state;
  }

  it('emits the abandonment signal and forfeits when a ranked seat crosses the timeout threshold', () => {
    const seed = fixedSeeder();
    const state = bootRanked(seed, true, 1); // threshold 1 → the first timeout crosses it
    const actor = state.engine!.public.seatToAct!;

    const result = expireClock(state, expiredClock, seed);

    const signal = result.effects.find((e): e is Extract<Effect, { kind: 'abandonmentSignal' }> => e.kind === 'abandonmentSignal');
    expect(signal).toBeDefined();
    expect(signal!.seat).toBe(actor);
    expect(signal!.timeoutCount).toBe(1);
    // The signal now drives a timeout_abandon forfeit (the seat is treated as a leaver,
    // not granted another forced move): the match resolves, rests at Complete, and emits
    // the persist effect carrying the assembled record.
    expect(result.state.resolution!.reason).toBe('timeout_abandon');
    expect(result.state.resolution!.outcomes.find((o) => o.seat === actor)!.outcome).toBe('abandoner_loss');
    expect(result.effects.some((e) => e.kind === 'abandonEvent')).toBe(true);
    expect(result.effects.some((e) => e.kind === 'persist')).toBe(true);
    expect(result.state.lifecycle).toBe('Complete');
  });

  it('does not emit the signal below the ranked threshold', () => {
    const seed = fixedSeeder();
    const state = bootRanked(seed, true, 3); // a single timeout stays under the threshold
    const result = expireClock(state, expiredClock, seed);
    expect(result.effects.some((e) => e.kind === 'abandonmentSignal')).toBe(false);
  });

  it('counts timeouts but never emits the signal in a casual room', () => {
    const seed = fixedSeeder();
    const state = bootRanked(seed, false, 1); // casual, threshold reachable — still no signal
    const actor = state.engine!.public.seatToAct!;
    const result = expireClock(state, expiredClock, seed);

    expect(result.effects.some((e) => e.kind === 'abandonmentSignal')).toBe(false);
    // The timeout is still tallied (per the open-question default: count, never signal).
    expect(result.state.seats.find((s) => s.seatIndex === actor)!.timeoutCount).toBe(1);
  });
});

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

  it('completes the match, emits a persist effect, then advances and disposes', () => {
    // A target-score of 1 guarantees the match ends after the first hand.
    const variant: VariantDefinition = { ...SINGLE_DECK_PARTNERS, matchEnd: { mode: 'target-score', target: 1 } };
    const seed = fixedSeeder();
    const { state } = bootAndDeal(variant, seed);
    const { state: after, last } = playOneHand(state, seed, variant);

    // Live → Complete: the room rests at Complete and emits exactly one persist effect
    // carrying the assembled record. It does NOT advance to Persisted itself — that is
    // the adapter's job after the durable write. The engine state is retained so the
    // final broadcast views stay valid.
    expect(after.lifecycle).toBe('Complete');
    const persists = last.effects.filter((e) => e.kind === 'persist');
    expect(persists).toHaveLength(1);
    expect(after.engine).not.toBeNull();
    expect(after.engine!.public.matchResult?.complete).toBe(true);
    const finalView = last.effects.map((e) => ('view' in e ? e.view : undefined)).find((v) => v?.public.matchResult != null);
    expect(finalView).toBeDefined();

    // The adapter confirms the write, marks the room Persisted, then disposes — the only
    // step that releases the engine and tears the room down.
    const persisted = markPersisted(after).state;
    expect(persisted.lifecycle).toBe('Persisted');
    const disposed = disposeRoom(persisted).state;
    expect(disposed.lifecycle).toBe('Disposed');
    expect(disposed.engine).toBeNull();
  });
});
