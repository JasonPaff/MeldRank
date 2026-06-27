import { describe, expect, it } from 'vitest';
import { SINGLE_DECK_PARTNERS } from '@meldrank/shared';
import type { FilteredView } from '@meldrank/engine';
import { createRoomCore, expireGrace, joinRoom, leaveRoom, submitContribution, submitIntent } from './core';
import { DEFAULT_CLOCK_CONFIG } from './clock';
import { seatForConnection } from './seating';
import type { Clock, Effect, RoomCoreState, ServerSeedSource } from './types';

function fixedSeeder(start = 1): ServerSeedSource {
  let n = start;
  return () => {
    const bytes = new Uint8Array(32);
    bytes[0] = n & 0xff;
    n += 1;
    return bytes;
  };
}

function clientSeed(seat: number): Uint8Array {
  const bytes = new Uint8Array(32);
  bytes[0] = 100 + seat;
  return bytes;
}

/** A fixed clock anchored at 0; most loop assertions are time-insensitive. */
const clock: Clock = () => 0;

/** A clock returning whatever `set` was last assigned — drives charge-over-turns. */
function mutableClock(): { clock: Clock; set: (t: number) => void } {
  let t = 0;
  return { clock: () => t, set: (next) => (t = next) };
}

/** A Live Partners room with a hand dealt and resting at Auction. */
function dealtPartners(c: Clock = clock): { state: RoomCoreState; seed: ServerSeedSource } {
  const seed = fixedSeeder();
  let state = createRoomCore(SINGLE_DECK_PARTNERS);
  const count = SINGLE_DECK_PARTNERS.seating.playerCount;
  for (let i = 0; i < count; i++) state = joinRoom(state, `conn-${i}`, seed, c).state;
  for (let i = 0; i < count; i++) state = submitContribution(state, `conn-${i}`, clientSeed(i), c).state;
  return { state, seed };
}

/** The connection id seated at `seat`. */
function connFor(state: RoomCoreState, seat: number): string {
  return state.seats.find((s) => s.seatIndex === seat)!.connectionId;
}

function viewOf(effect: Effect): FilteredView | undefined {
  return effect.kind === 'view' || effect.kind === 'accept' || effect.kind === 'reject' ? effect.view : undefined;
}

describe('authoritative intent loop', () => {
  it('applies a legal in-turn intent and broadcasts per-seat views', () => {
    const { state, seed } = dealtPartners();
    const actor = state.engine!.public.seatToAct!;
    const conn = connFor(state, actor);

    const result = submitIntent(state, conn, { type: 'bid', seat: actor, value: 250 }, 'corr-1', seed, clock);

    // Engine advanced (auction recorded the bid; turn moved on).
    expect(result.state.engine).not.toBe(state.engine);
    // Submitter gets an accept ack correlated to its intent, carrying its view.
    const accept = result.effects.find((e) => e.kind === 'accept');
    expect(accept).toMatchObject({ kind: 'accept', connectionId: conn, correlationId: 'corr-1' });
    // Every other seat gets a view broadcast.
    const views = result.effects.filter((e) => e.kind === 'view');
    expect(views).toHaveLength(SINGLE_DECK_PARTNERS.seating.playerCount - 1);
    expect(views.some((v) => v.connectionId === conn)).toBe(false);
  });

  it('leaves state unchanged and sends no other-seat broadcast on an illegal intent', () => {
    const { state, seed } = dealtPartners();
    const actor = state.engine!.public.seatToAct!;
    const conn = connFor(state, actor);

    // 255 is off the bid increment grid → the engine rejects it.
    const result = submitIntent(state, conn, { type: 'bid', seat: actor, value: 255 }, 'corr-2', seed, clock);

    expect(result.state).toBe(state); // unchanged
    expect(result.effects).toHaveLength(1);
    expect(result.effects[0]).toMatchObject({ kind: 'reject', reason: 'illegal-move', correlationId: 'corr-2' });
    // The reject carries a corrective resync view for the submitter.
    expect(viewOf(result.effects[0]!)).toBeDefined();
  });

  it('rejects a spoofed seat without applying it', () => {
    const { state, seed } = dealtPartners();
    const actor = state.engine!.public.seatToAct!;
    const conn = connFor(state, actor);
    const otherSeat = (actor + 1) % SINGLE_DECK_PARTNERS.seating.playerCount;

    const result = submitIntent(state, conn, { type: 'bid', seat: otherSeat, value: 250 }, 'corr-3', seed, clock);
    expect(result.state).toBe(state);
    expect(result.effects[0]).toMatchObject({ kind: 'reject', reason: 'not-your-seat' });
  });

  it('rejects an out-of-turn intent', () => {
    const { state, seed } = dealtPartners();
    const actor = state.engine!.public.seatToAct!;
    const offTurnSeat = (actor + 1) % SINGLE_DECK_PARTNERS.seating.playerCount;
    const offTurnConn = connFor(state, offTurnSeat);

    const result = submitIntent(state, offTurnConn, { type: 'bid', seat: offTurnSeat, value: 250 }, 'corr-4', seed, clock);
    expect(result.state).toBe(state);
    expect(result.effects[0]).toMatchObject({ kind: 'reject', reason: 'out-of-turn' });
  });

  it('projects a distinct payload per recipient', () => {
    const { state, seed } = dealtPartners();
    const actor = state.engine!.public.seatToAct!;
    const conn = connFor(state, actor);
    const result = submitIntent(state, conn, { type: 'bid', seat: actor, value: 250 }, 'corr-5', seed, clock);

    const hands = result.effects
      .map(viewOf)
      .filter((v): v is FilteredView => v !== undefined)
      .map((v) => JSON.stringify(v.own?.hand ?? []));
    // Four recipients (accept + three views), each with its own distinct hand.
    expect(hands).toHaveLength(SINGLE_DECK_PARTNERS.seating.playerCount);
    expect(new Set(hands).size).toBe(hands.length);
  });

  it('rejects intents once the match has resolved (capability match-disconnect-abandonment)', () => {
    const seed = fixedSeeder();
    let state = createRoomCore(SINGLE_DECK_PARTNERS, { ranked: true });
    const count = SINGLE_DECK_PARTNERS.seating.playerCount;
    for (let i = 0; i < count; i++) state = joinRoom(state, `conn-${i}`, seed, clock).state;
    for (let i = 0; i < count; i++) state = submitContribution(state, `conn-${i}`, clientSeed(i), clock).state;

    // Forfeit the match via a grace expiry, then attempt a move on the resolved room.
    const dropped = leaveRoom(state, connFor(state, 0), () => 0).state;
    const resolved = expireGrace(dropped, 0, () => DEFAULT_CLOCK_CONFIG.reconnectGraceMs, seed).state;
    expect(resolved.resolution).not.toBeNull();

    const actor = resolved.engine!.public.seatToAct!;
    const result = submitIntent(resolved, connFor(resolved, actor), { type: 'bid', seat: actor, value: 250 }, 'corr-resolved', seed, clock);
    expect(result.state).toBe(resolved); // nothing applied
    expect(result.effects[0]).toMatchObject({ kind: 'reject', reason: 'room-not-live' });
  });

  it('sends a full view to a newly seated connection on join', () => {
    const seed = fixedSeeder();
    const state = createRoomCore(SINGLE_DECK_PARTNERS);
    const join = joinRoom(state, 'conn-0', seed, clock);
    const view = join.effects.find((e) => e.kind === 'view');
    expect(view).toMatchObject({ kind: 'view', connectionId: 'conn-0' });
    expect(seatForConnection(join.state, 'conn-0')).toBe(0);
  });
});

describe('move-clock charging across turns', () => {
  const config = DEFAULT_CLOCK_CONFIG;
  const playerCount = SINGLE_DECK_PARTNERS.seating.playerCount;

  it('charges the acting seat its elapsed base time and grants the next seat a fresh base', () => {
    const m = mutableClock();
    m.set(1_000);
    const { state, seed } = dealtPartners(m.clock); // deal stamps turnStartedAt = 1000
    expect(state.turnStartedAt).toBe(1_000);
    const actor = state.engine!.public.seatToAct!;
    const conn = connFor(state, actor);

    // The actor holds the turn for 5s before bidding.
    m.set(6_000);
    const result = submitIntent(state, conn, { type: 'bid', seat: actor, value: 250 }, 'k', seed, m.clock);

    const actorClock = result.state.seats.find((s) => s.seatIndex === actor)!;
    expect(actorClock.remainingBaseMs).toBe(config.baseMs - 5_000); // 5s off base
    expect(actorClock.remainingReserveMs).toBe(config.reserveMs); // reserve untouched

    const nextActor = result.state.engine!.public.seatToAct!;
    expect(nextActor).not.toBe(actor);
    const nextClock = result.state.seats.find((s) => s.seatIndex === nextActor)!;
    expect(nextClock.remainingBaseMs).toBe(config.baseMs); // fresh base
    expect(result.state.turnStartedAt).toBe(6_000); // new turn stamped
  });

  it('overflows a turn longer than the base into the reserve bank', () => {
    const m = mutableClock();
    m.set(0);
    const { state, seed } = dealtPartners(m.clock); // turnStartedAt = 0
    const actor = state.engine!.public.seatToAct!;
    const conn = connFor(state, actor);

    m.set(config.baseMs + 4_000); // 4s past the base allotment
    const result = submitIntent(state, conn, { type: 'bid', seat: actor, value: 250 }, 'k', seed, m.clock);

    const actorClock = result.state.seats.find((s) => s.seatIndex === actor)!;
    expect(actorClock.remainingBaseMs).toBe(0);
    expect(actorClock.remainingReserveMs).toBe(config.reserveMs - 4_000);
  });

  it('broadcasts per-seat clock state carrying the acting seat, deadline, and all banks', () => {
    const { state, seed } = dealtPartners();
    const actor = state.engine!.public.seatToAct!;
    const conn = connFor(state, actor);
    const result = submitIntent(state, conn, { type: 'bid', seat: actor, value: 250 }, 'k', seed, clock);

    const clockEffects = result.effects.filter((e): e is Extract<Effect, { kind: 'clockState' }> => e.kind === 'clockState');
    expect(clockEffects).toHaveLength(playerCount); // one per seated connection
    const sample = clockEffects[0]!;
    expect(sample.actingSeat).toBe(result.state.engine!.public.seatToAct);
    expect(sample.deadline).not.toBeNull();
    expect(sample.seats).toHaveLength(playerCount);
  });
});
