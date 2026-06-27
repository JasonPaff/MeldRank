import type { ClockConfig, RoomCoreState, SeatAssignment } from './types';

/**
 * Seat-filling helpers (spec: match-room-lifecycle, "Seat filling and identity").
 * A connection is assigned a **stable** seat index for the duration of the room;
 * seat identity is a stubbed token (Clerk and reconnection tokens are deferred).
 */

/** The seat index assigned to `connectionId`, or `null` when it holds no seat. */
export function seatForConnection(state: RoomCoreState, connectionId: string): number | null {
  const assignment = state.seats.find((seat) => seat.connectionId === connectionId);
  return assignment?.seatIndex ?? null;
}

/** Whether `seatIndex` is currently occupied. */
export function isSeatOccupied(state: RoomCoreState, seatIndex: number): boolean {
  return state.seats.some((seat) => seat.seatIndex === seatIndex);
}

/** Whether every seat is filled. */
export function isFull(state: RoomCoreState): boolean {
  return state.seats.length >= state.seatCount;
}

/** The lowest unoccupied seat index, or `null` when the room is full. */
export function lowestFreeSeat(state: RoomCoreState): number | null {
  for (let seat = 0; seat < state.seatCount; seat++) {
    if (!isSeatOccupied(state, seat)) {
      return seat;
    }
  }
  return null;
}

/**
 * The stub seat token for this slice: a deterministic, opaque string derived from
 * the seat index and connection. It carries no real identity — it only stands in
 * for the Clerk-backed token a later slice will mint.
 */
export function stubSeatToken(seatIndex: number, connectionId: string): string {
  return `seat-${seatIndex}:${connectionId}`;
}

/**
 * A new seats list with `connectionId` seated at `seatIndex`, ordered by seat index.
 * The seat's move-clock banks are initialized from `config`: a full base allotment and
 * a full reserve (the reserve is initialized once, here, and never refilled — design
 * D2), with a zero timeout tally.
 */
export function withSeat(seats: readonly SeatAssignment[], seatIndex: number, connectionId: string, config: ClockConfig): SeatAssignment[] {
  const assignment: SeatAssignment = {
    seatIndex,
    connectionId,
    token: stubSeatToken(seatIndex, connectionId),
    remainingBaseMs: config.baseMs,
    remainingReserveMs: config.reserveMs,
    timeoutCount: 0,
  };
  return [...seats, assignment].sort((a, b) => a.seatIndex - b.seatIndex);
}
