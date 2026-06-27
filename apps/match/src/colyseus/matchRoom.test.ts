import { describe, expect, it } from 'vitest';
import { SINGLE_DECK_PARTNERS } from '@meldrank/shared';
import { createRoomCore, expireGrace, joinRoom, leaveRoom, pendingDeadline, reconnect, submitContribution } from '../room';
import type { Clock, RoomCoreState, ServerSeedSource } from '../room';
import { MatchRoom } from './matchRoom';
import type { RoomMetadata } from './schema';

/**
 * Adapter smoke test (task 4.4): the `MatchRoom` Colyseus shell is otherwise a thin
 * translator over the pure `RoomCore`, but it owns one piece of real logic worth
 * pinning — mirroring each seat's `connectionStatus` into the synced
 * {@link RoomMetadata} presence (`occupancy`/`seatStatus`) so the lobby/table UI can
 * render a dropped or bot-held seat. We construct a real room, drive its core to a
 * shape carrying every status, and assert the projected schema. The core itself is
 * exercised exhaustively in `room/abandonment.test.ts`; here we only verify the wiring.
 */

/** Reach the adapter's private state-projection surface for the smoke assertions. */
interface RoomInternals {
  core: RoomCoreState;
  state: RoomMetadata;
  syncMetadata(): void;
}

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

/** A fixed clock anchored at 0; the deal stamps the first turn at t = 0. */
const clock: Clock = () => 0;

/** The connection id seated at `seat`. */
function connFor(state: RoomCoreState, seat: number): string {
  return state.seats.find((s) => s.seatIndex === seat)!.connectionId;
}

/** Boot a Live casual Partners room dealt to Auction. */
function bootDealt(): RoomCoreState {
  const seed = fixedSeeder();
  let state = createRoomCore(SINGLE_DECK_PARTNERS);
  const count = SINGLE_DECK_PARTNERS.seating.playerCount;
  for (let i = 0; i < count; i++) state = joinRoom(state, `conn-${i}`, seed, clock).state;
  for (let i = 0; i < count; i++) state = submitContribution(state, `conn-${i}`, clientSeed(i), clock).state;
  return state;
}

/** A `MatchRoom` constructed and `onCreate`d, with its private surface exposed. */
function newRoom(): RoomInternals {
  const room = new MatchRoom();
  room.onCreate({});
  return room as unknown as RoomInternals;
}

describe('MatchRoom presence projection (task 4.4)', () => {
  it('initializes every seat Empty and unoccupied on create', () => {
    const room = newRoom();
    expect(room.state.lifecycle).toBe('Reserved');
    expect([...room.state.occupancy]).toEqual([false, false, false, false]);
    expect([...room.state.seatStatus]).toEqual(['Empty', 'Empty', 'Empty', 'Empty']);
  });

  it('reflects per-seat connection status (Disconnected, BotControlled, Connected) into the schema', () => {
    const room = newRoom();
    // Seat 0 drops and stays in grace → Disconnected; seat 1 drops and its casual
    // grace expires → BotControlled; seats 2 and 3 remain Connected.
    let core = bootDealt();
    core = leaveRoom(core, connFor(core, 0), () => 0).state;
    core = leaveRoom(core, connFor(core, 1), () => 0).state;
    core = expireGrace(core, 1, () => core.config.reconnectGraceMs, fixedSeeder()).state;
    room.core = core;

    room.syncMetadata();

    expect(room.state.lifecycle).toBe('Live');
    expect([...room.state.occupancy]).toEqual([true, true, true, true]);
    expect([...room.state.seatStatus]).toEqual(['Disconnected', 'BotControlled', 'Connected', 'Connected']);
    // The coarse table-level countdown anchor mirrors the room's pending deadline.
    expect(room.state.clockDeadline).toBe(pendingDeadline(core)!.at);
    expect(room.state.seatToAct).toBe(core.engine!.public.seatToAct ?? -1);
  });

  it('clears a reclaimed seat back to Connected in the schema', () => {
    const room = newRoom();
    const dealt = bootDealt();
    const token = dealt.seats.find((s) => s.seatIndex === 0)!.token;
    const dropped = leaveRoom(dealt, connFor(dealt, 0), () => 0).state;
    room.core = dropped;
    room.syncMetadata();
    expect([...room.state.seatStatus]).toEqual(['Disconnected', 'Connected', 'Connected', 'Connected']);

    // The seat reconnects within grace; the projection follows it back to Connected.
    room.core = reconnect(dropped, token, 'conn-0-new', clock).state;
    room.syncMetadata();
    expect([...room.state.seatStatus]).toEqual(['Connected', 'Connected', 'Connected', 'Connected']);
  });
});
