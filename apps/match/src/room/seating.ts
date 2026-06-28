import type { ClockConfig, RoomCoreState, SeatAssignment } from './types';

/** The synthetic connection id minted for a cold-start seat-fill bot at `seatIndex`. */
export function botConnectionId(seatIndex: number): string {
  return `bot:${seatIndex}`;
}

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
 * D2), with a zero timeout tally. `isBot` marks a cold-start seat-fill bot (capability
 * `bot-seating`); it defaults to `false` for a human join.
 */
export function withSeat(
  seats: readonly SeatAssignment[],
  seatIndex: number,
  connectionId: string,
  config: ClockConfig,
  isBot = false,
): SeatAssignment[] {
  const assignment: SeatAssignment = {
    seatIndex,
    connectionId,
    token: stubSeatToken(seatIndex, connectionId),
    remainingBaseMs: config.baseMs,
    remainingReserveMs: config.reserveMs,
    timeoutCount: 0,
    connectionStatus: 'Connected',
    graceDeadline: null,
    isBot,
  };
  return [...seats, assignment].sort((a, b) => a.seatIndex - b.seatIndex);
}

/**
 * Whether a seat is bot-driven **right now** (capability `bot-seating`, design D1):
 * a cold-start seat-fill bot (`isBot`) or a casual human seat handed to a bot after
 * grace (`connectionStatus: 'BotControlled'`). The adapter drives a seat's turn
 * through the bot brain whenever this holds, regardless of which signal set it.
 */
export function isBotDriven(seat: SeatAssignment): boolean {
  return seat.isBot || seat.connectionStatus === 'BotControlled';
}

/**
 * The seat the engine currently expects a move from (capability `bot-seating`):
 * normally `engine.public.seatToAct`, but `DeclareTrump` and `Bury` are gated by the
 * contract winner rather than by turn order (the engine leaves `seatToAct` null in
 * those phases), so the bid winner is the actor there. `null` when no seat is to act
 * (between hands, a deterministic pass-through phase, or pre-deal/terminal).
 */
export function engineActingSeat(state: RoomCoreState): number | null {
  const engine = state.engine;
  if (engine === null) {
    return null;
  }
  if (engine.public.seatToAct !== null) {
    return engine.public.seatToAct;
  }
  if (engine.public.phase === 'DeclareTrump' || engine.public.phase === 'Bury') {
    return engine.public.contract?.seatIndex ?? null;
  }
  return null;
}

/**
 * The bot seat the adapter should drive next (capability `bot-seating`, design D3),
 * or `null` when no bot is awaiting a move. A bot is driven only while the room is
 * `Live` and unresolved, only for the single seat the engine expects to act
 * ({@link engineActingSeat}), and only when that seat is bot-driven
 * ({@link isBotDriven}) — so a human on the clock is never acted for.
 */
export function botSeatToDrive(state: RoomCoreState): number | null {
  if (state.lifecycle !== 'Live' || state.resolution !== null) {
    return null;
  }
  const seat = engineActingSeat(state);
  if (seat === null) {
    return null;
  }
  const assignment = state.seats.find((s) => s.seatIndex === seat);
  if (assignment === undefined) {
    return null;
  }
  return isBotDriven(assignment) ? seat : null;
}
