import { describe, expect, it } from 'vitest';
import { SINGLE_DECK_PARTNERS } from '@meldrank/shared';
import { advanceLifecycle, isLegalRoomTransition } from './lifecycle';
import { createRoomCore, disposeRoom, joinRoom, submitContribution, submitIntent } from './core';
import { isFull, seatForConnection } from './seating';
import type { Effect, RoomLifecycle, ServerSeedSource } from './types';

/** A deterministic server-seed source so the whole flow is reproducible in tests. */
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

/** Fill every seat of a fresh Partners room, returning the seated state. */
function fillPartners(seed = fixedSeeder()) {
  let state = createRoomCore(SINGLE_DECK_PARTNERS);
  for (let i = 0; i < SINGLE_DECK_PARTNERS.seating.playerCount; i++) {
    state = joinRoom(state, `conn-${i}`, seed).state;
  }
  return state;
}

describe('room lifecycle machine', () => {
  it('permits only the ordered forward path', () => {
    expect(isLegalRoomTransition('Reserved', 'Filling')).toBe(true);
    expect(isLegalRoomTransition('Filling', 'Live')).toBe(true);
    expect(isLegalRoomTransition('Live', 'Complete')).toBe(true);
    expect(isLegalRoomTransition('Complete', 'Persisted')).toBe(true);
    expect(isLegalRoomTransition('Persisted', 'Disposed')).toBe(true);
  });

  it('permits early disposal only before going Live', () => {
    expect(isLegalRoomTransition('Reserved', 'Disposed')).toBe(true);
    expect(isLegalRoomTransition('Filling', 'Disposed')).toBe(true);
    // The spec's out-of-order example: Live → Disposed skipping Complete is rejected.
    expect(isLegalRoomTransition('Live', 'Disposed')).toBe(false);
  });

  it('rejects out-of-order transitions', () => {
    expect(isLegalRoomTransition('Reserved', 'Live')).toBe(false);
    expect(isLegalRoomTransition('Live', 'Persisted')).toBe(false);
    expect(isLegalRoomTransition('Complete', 'Disposed')).toBe(false);
    expect(advanceLifecycle('Live', 'Disposed')).toBeNull();
    expect(advanceLifecycle('Filling', 'Live')).toBe<RoomLifecycle>('Live');
  });
});

describe('room construction and seating', () => {
  it('constructs its engine state on creation with no dealt cards', () => {
    const state = createRoomCore(SINGLE_DECK_PARTNERS);
    expect(state.lifecycle).toBe<RoomLifecycle>('Reserved');
    expect(state.seats).toHaveLength(0);
    expect(state.engine).not.toBeNull();
    expect(state.engine!.public.phase).toBe('Dealing');
    expect(state.engine!.private.hands).toHaveLength(0);
  });

  it('enters Filling on first join and Live once full, dealing the first hand', () => {
    const seed = fixedSeeder();
    let state = createRoomCore(SINGLE_DECK_PARTNERS);

    const first = joinRoom(state, 'conn-0', seed);
    expect(first.state.lifecycle).toBe<RoomLifecycle>('Filling');
    expect(first.outcome).toEqual({ status: 'seated', seat: 0 });
    // The joiner receives a full resync view.
    expect(first.effects.filter((e) => e.kind === 'view')).toHaveLength(1);
    state = first.state;

    state = joinRoom(state, 'conn-1', seed).state;
    state = joinRoom(state, 'conn-2', seed).state;
    const last = joinRoom(state, 'conn-3', seed);

    expect(last.state.lifecycle).toBe<RoomLifecycle>('Live');
    expect(isFull(last.state)).toBe(true);
    // Going Live begins the first hand: a commit is broadcast to every seat.
    const commits = last.effects.filter((e: Effect) => e.kind === 'commit');
    expect(commits).toHaveLength(SINGLE_DECK_PARTNERS.seating.playerCount);
    expect(last.state.handshake).not.toBeNull();
  });

  it('assigns stable seat indices that do not change', () => {
    const state = fillPartners();
    expect(seatForConnection(state, 'conn-0')).toBe(0);
    expect(seatForConnection(state, 'conn-3')).toBe(3);
  });

  it('rejects a join when the room is full, leaving seats unchanged', () => {
    const state = fillPartners();
    const result = joinRoom(state, 'conn-late', fixedSeeder());
    expect(result.outcome).toEqual({ status: 'rejected', reason: 'room-full' });
    expect(result.state.seats).toEqual(state.seats);
  });

  it('rejects a join onto an already-occupied seat', () => {
    const seed = fixedSeeder();
    let state = createRoomCore(SINGLE_DECK_PARTNERS);
    state = joinRoom(state, 'conn-0', seed, 1).state;
    const clash = joinRoom(state, 'conn-1', seed, 1);
    expect(clash.outcome).toEqual({ status: 'rejected', reason: 'seat-occupied' });
  });

  it('rejects a duplicate join from the same connection', () => {
    const seed = fixedSeeder();
    let state = createRoomCore(SINGLE_DECK_PARTNERS);
    state = joinRoom(state, 'conn-0', seed).state;
    const again = joinRoom(state, 'conn-0', seed);
    expect(again.outcome).toEqual({ status: 'rejected', reason: 'already-seated' });
  });
});

describe('room disposal', () => {
  it('releases engine state and rejects further input once Disposed', () => {
    let state = createRoomCore(SINGLE_DECK_PARTNERS);
    state = joinRoom(state, 'conn-0', fixedSeeder()).state; // Filling — early disposal is legal
    const disposed = disposeRoom(state).state;

    expect(disposed.lifecycle).toBe<RoomLifecycle>('Disposed');
    expect(disposed.engine).toBeNull();

    // No further join, intent, or contribution is accepted.
    expect(joinRoom(disposed, 'conn-1', fixedSeeder()).outcome).toEqual({ status: 'rejected', reason: 'disposed' });
    expect(submitIntent(disposed, 'conn-0', { type: 'pass', seat: 0 }, 'c1', fixedSeeder()).effects).toHaveLength(0);
    expect(submitContribution(disposed, 'conn-0', new Uint8Array(32)).effects[0]).toMatchObject({
      kind: 'rejectContribution',
      reason: 'room-not-live',
    });
  });

  it('rejects an out-of-order disposal of a Live room', () => {
    const live = fillPartners();
    expect(live.lifecycle).toBe<RoomLifecycle>('Live');
    const result = disposeRoom(live);
    expect(result.state).toBe(live); // unchanged
  });
});
