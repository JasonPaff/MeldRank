import { describe, expect, it } from 'vitest';
import { SINGLE_DECK_PARTNERS } from '@meldrank/shared';
import type { FilteredView } from '@meldrank/engine';
import { createRoomCore, joinRoom, submitContribution, submitIntent } from './core';
import { seatForConnection } from './seating';
import type { Effect, RoomCoreState, ServerSeedSource } from './types';

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

/** A Live Partners room with a hand dealt and resting at Auction. */
function dealtPartners(): { state: RoomCoreState; seed: ServerSeedSource } {
  const seed = fixedSeeder();
  let state = createRoomCore(SINGLE_DECK_PARTNERS);
  const count = SINGLE_DECK_PARTNERS.seating.playerCount;
  for (let i = 0; i < count; i++) state = joinRoom(state, `conn-${i}`, seed).state;
  for (let i = 0; i < count; i++) state = submitContribution(state, `conn-${i}`, clientSeed(i)).state;
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

    const result = submitIntent(state, conn, { type: 'bid', seat: actor, value: 250 }, 'corr-1', seed);

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
    const result = submitIntent(state, conn, { type: 'bid', seat: actor, value: 255 }, 'corr-2', seed);

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

    const result = submitIntent(state, conn, { type: 'bid', seat: otherSeat, value: 250 }, 'corr-3', seed);
    expect(result.state).toBe(state);
    expect(result.effects[0]).toMatchObject({ kind: 'reject', reason: 'not-your-seat' });
  });

  it('rejects an out-of-turn intent', () => {
    const { state, seed } = dealtPartners();
    const actor = state.engine!.public.seatToAct!;
    const offTurnSeat = (actor + 1) % SINGLE_DECK_PARTNERS.seating.playerCount;
    const offTurnConn = connFor(state, offTurnSeat);

    const result = submitIntent(state, offTurnConn, { type: 'bid', seat: offTurnSeat, value: 250 }, 'corr-4', seed);
    expect(result.state).toBe(state);
    expect(result.effects[0]).toMatchObject({ kind: 'reject', reason: 'out-of-turn' });
  });

  it('projects a distinct payload per recipient', () => {
    const { state, seed } = dealtPartners();
    const actor = state.engine!.public.seatToAct!;
    const conn = connFor(state, actor);
    const result = submitIntent(state, conn, { type: 'bid', seat: actor, value: 250 }, 'corr-5', seed);

    const hands = result.effects
      .map(viewOf)
      .filter((v): v is FilteredView => v !== undefined)
      .map((v) => JSON.stringify(v.own?.hand ?? []));
    // Four recipients (accept + three views), each with its own distinct hand.
    expect(hands).toHaveLength(SINGLE_DECK_PARTNERS.seating.playerCount);
    expect(new Set(hands).size).toBe(hands.length);
  });

  it('sends a full view to a newly seated connection on join', () => {
    const seed = fixedSeeder();
    const state = createRoomCore(SINGLE_DECK_PARTNERS);
    const join = joinRoom(state, 'conn-0', seed);
    const view = join.effects.find((e) => e.kind === 'view');
    expect(view).toMatchObject({ kind: 'view', connectionId: 'conn-0' });
    expect(seatForConnection(join.state, 'conn-0')).toBe(0);
  });
});
