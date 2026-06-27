import { createInitialState, reduce, viewFor, type FilteredView, type State } from '@meldrank/engine';
import type { SeatContribution } from '@meldrank/fairness';
import type { VariantDefinition } from '@meldrank/shared';
import { advanceLifecycle } from './lifecycle';
import { isFull, lowestFreeSeat, isSeatOccupied, seatForConnection, withSeat } from './seating';
import { assembleAndDeal, openHand } from './handshake';
import type { Effect, IntentRejectReason, JoinResult, PlayerIntent, RoomCoreState, ServerSeedSource, StepResult } from './types';

/**
 * The pure `RoomCore` (design D2): the room lifecycle machine plus the authoritative
 * `validate → apply → advance → broadcast` intent loop, expressed as a set of pure
 * functions returning `{ state, effects }`. The Colyseus `Room` is a thin adapter
 * that calls these and performs the sends; nothing here touches a socket, a clock,
 * or a database, so the integrity-critical loop is fully unit-testable. The server
 * holds the engine `State` whole; clients only ever receive per-seat `viewFor`
 * projections carried on the emitted effects (design D1).
 */

/**
 * Construct a room from its variant. The single authoritative engine `State` is
 * built here via `createInitialState` (spec: "Room constructs its engine state on
 * creation"); no card-bearing state exists until a hand is dealt.
 */
export function createRoomCore(variant: VariantDefinition): RoomCoreState {
  return {
    lifecycle: 'Reserved',
    variant,
    seatCount: variant.seating.playerCount,
    seats: [],
    engine: createInitialState(variant),
    handshake: null,
    handsDealt: 0,
  };
}

/**
 * The view a recipient is entitled to. Before a hand is dealt the engine carries no
 * hands, so a seat index has nothing to project — we fall back to the spectator
 * (public-only) view rather than throwing. Once dealt, every seated recipient gets
 * its own `viewFor(state, seat)`.
 */
function safeView(engine: State, seat: number | null): FilteredView {
  if (seat !== null && seat < engine.private.hands.length) {
    return viewFor(engine, seat);
  }
  return viewFor(engine, null);
}

/** One `view` effect per seated connection, each carrying that seat's own projection. */
function broadcastViews(state: RoomCoreState, engine: State): Effect[] {
  return state.seats.map((seat) => ({ kind: 'view', connectionId: seat.connectionId, view: safeView(engine, seat.seatIndex) }));
}

/** One `view` effect per seated connection **other than** `exceptConnectionId`. */
function broadcastViewsExcept(state: RoomCoreState, engine: State, exceptConnectionId: string): Effect[] {
  return state.seats
    .filter((seat) => seat.connectionId !== exceptConnectionId)
    .map((seat) => ({ kind: 'view', connectionId: seat.connectionId, view: safeView(engine, seat.seatIndex) }));
}

/**
 * Begin a hand: open the commit window (resetting the engine to the next hand's
 * `Dealing` base when a prior hand just scored) and broadcast the commitment hash to
 * every seat **before** any card is dealt (spec: "Commit precedes every deal"). The
 * server seed is drawn from the injected source and never leaves the server.
 */
function beginHand(state: RoomCoreState, seed: ServerSeedSource): StepResult {
  const { engine, handshake } = openHand(state.engine!, state.handsDealt, seed());
  const next: RoomCoreState = { ...state, engine, handshake, handsDealt: state.handsDealt + 1 };
  const effects: Effect[] = next.seats.map((seat) => ({
    kind: 'commit',
    connectionId: seat.connectionId,
    handNonce: handshake.handNonce,
    commit: handshake.commit,
  }));
  return { state: next, effects };
}

/**
 * Seat a joining connection (spec: "Seat filling and identity"). Assigns the lowest
 * free seat (or a requested `desiredSeat`), rejecting a full room, an occupied target
 * seat, or a duplicate join. The joiner immediately receives a full authoritative
 * view for its seat (spec: "Full state resync on join"). When the join fills the
 * room, the lifecycle advances `Filling → Live` and the first hand begins (its commit
 * is broadcast to all seats).
 */
export function joinRoom(state: RoomCoreState, connectionId: string, seed: ServerSeedSource, desiredSeat?: number): JoinResult {
  if (state.lifecycle === 'Disposed') {
    return { state, effects: [], outcome: { status: 'rejected', reason: 'disposed' } };
  }
  if (seatForConnection(state, connectionId) !== null) {
    return { state, effects: [], outcome: { status: 'rejected', reason: 'already-seated' } };
  }

  let seatIndex: number;
  if (desiredSeat !== undefined) {
    if (!Number.isInteger(desiredSeat) || desiredSeat < 0 || desiredSeat >= state.seatCount) {
      return { state, effects: [], outcome: { status: 'rejected', reason: 'room-full' } };
    }
    if (isSeatOccupied(state, desiredSeat)) {
      return { state, effects: [], outcome: { status: 'rejected', reason: 'seat-occupied' } };
    }
    seatIndex = desiredSeat;
  } else {
    const free = lowestFreeSeat(state);
    if (free === null) {
      return { state, effects: [], outcome: { status: 'rejected', reason: 'room-full' } };
    }
    seatIndex = free;
  }

  const seats = withSeat(state.seats, seatIndex, connectionId);
  const lifecycle = state.lifecycle === 'Reserved' ? advanceLifecycle('Reserved', 'Filling')! : state.lifecycle;
  let next: RoomCoreState = { ...state, seats, lifecycle };

  // Full resync to the newly seated connection (pre-deal: a public snapshot).
  const effects: Effect[] = [{ kind: 'view', connectionId, view: safeView(next.engine!, seatIndex) }];

  if (isFull(next)) {
    next = { ...next, lifecycle: advanceLifecycle(next.lifecycle, 'Live')! };
    const began = beginHand(next, seed);
    next = began.state;
    effects.push(...began.effects);
  }

  return { state: next, effects, outcome: { status: 'seated', seat: seatIndex } };
}

/**
 * Record a seat's `clientSeed` contribution (spec: match-shuffle-handshake,
 * "Contribute-after-commit ordering"). Accepted only while the room is `Live`, from a
 * seated connection, after the hand's commit has been published, and at most once per
 * seat. When the final seat contributes, the deal window closes immediately: the seed
 * is assembled and the hand dealt, and every seat receives its own dealt view.
 */
export function submitContribution(state: RoomCoreState, connectionId: string, clientSeed: Uint8Array): StepResult {
  if (state.lifecycle !== 'Live') {
    return { state, effects: [{ kind: 'rejectContribution', connectionId, reason: 'room-not-live' }] };
  }
  const seat = seatForConnection(state, connectionId);
  if (seat === null) {
    return { state, effects: [{ kind: 'rejectContribution', connectionId, reason: 'not-seated' }] };
  }
  if (state.handshake === null) {
    return { state, effects: [{ kind: 'rejectContribution', connectionId, reason: 'no-open-commit' }] };
  }
  if (state.handshake.contributions.some((contribution) => contribution.seat === seat)) {
    return { state, effects: [{ kind: 'rejectContribution', connectionId, reason: 'already-contributed' }] };
  }

  const contribution: SeatContribution = { seat, clientSeed };
  const contributions = [...state.handshake.contributions, contribution];
  const handshake = { ...state.handshake, contributions };
  const next: RoomCoreState = { ...state, handshake };

  // Window-close policy in this slice (no clock yet, design D5): deal once every
  // seated connection has contributed; absent seats fall back deterministically.
  if (contributions.length >= state.seatCount) {
    const dealt = assembleAndDeal(next.engine!, handshake, state.seatCount);
    const afterDeal: RoomCoreState = { ...next, engine: dealt, handshake: null };
    return { state: afterDeal, effects: broadcastViews(afterDeal, dealt) };
  }
  return { state: next, effects: [] };
}

/**
 * The authoritative move loop (spec: match-intent-loop): `validate → apply → advance
 * → broadcast`. Room-level authority (seat ownership, then turn) is checked **before**
 * any engine call; the engine `reduce` is the sole rules authority for legality. A
 * legal intent acks the submitter with its authoritative resulting view and fans the
 * updated per-seat views out to the other connections; an illegal one mutates nothing
 * and only sends the submitter a reject with a corrective resync. When a hand finishes
 * scoring the next hand begins (re-running the handshake), and when the match
 * completes the room runs out through `Complete → Persisted`.
 */
export function submitIntent(
  state: RoomCoreState,
  connectionId: string,
  intent: PlayerIntent,
  correlationId: string,
  seed: ServerSeedSource,
): StepResult {
  const engine = state.engine;
  if (state.lifecycle !== 'Live' || engine === null) {
    // A disposed room has released its engine and accepts no input — drop silently.
    if (engine === null) {
      return { state, effects: [] };
    }
    const seat = seatForConnection(state, connectionId);
    return reject(state, connectionId, correlationId, 'room-not-live', safeView(engine, seat));
  }

  const seat = seatForConnection(state, connectionId);
  if (seat === null) {
    return reject(state, connectionId, correlationId, 'not-seated', safeView(engine, null));
  }
  // Seat authority: the intent must claim the connection's own seat (anti-spoof).
  if (intent.seat !== seat) {
    return reject(state, connectionId, correlationId, 'not-your-seat', safeView(engine, seat));
  }
  // Turn authority: when a seat is on the clock, only that seat may act. When
  // `seatToAct` is null (phases like DeclareTrump that the engine gates by contract
  // winner, not by turn order), we defer to the engine — "except where the engine's
  // own rules permit it" — and let `reduce` adjudicate legality below.
  if (engine.public.seatToAct !== null && engine.public.seatToAct !== seat) {
    return reject(state, connectionId, correlationId, 'out-of-turn', safeView(engine, seat));
  }

  // Engine legality: an illegal move returns the same state reference unchanged.
  const advanced = reduce(engine, intent);
  if (advanced === engine) {
    return reject(state, connectionId, correlationId, 'illegal-move', safeView(engine, seat));
  }

  // Accept: ack the submitter with its authoritative view, fan the rest out per seat.
  const effects: Effect[] = [
    { kind: 'accept', connectionId, correlationId, view: viewFor(advanced, seat) },
    ...broadcastViewsExcept(state, advanced, connectionId),
  ];
  let next: RoomCoreState = { ...state, engine: advanced };

  if (advanced.public.phase === 'MatchComplete') {
    next = completeAndPersist(next);
  } else if (advanced.public.phase === 'HandScoring') {
    // Hand finished, match continues: deal the next hand (re-run the handshake).
    const began = beginHand(next, seed);
    next = began.state;
    effects.push(...began.effects);
  }

  return { state: next, effects };
}

/** Build a reject effect (no other broadcast) leaving the room state unchanged. */
function reject(
  state: RoomCoreState,
  connectionId: string,
  correlationId: string,
  reason: IntentRejectReason,
  view: FilteredView,
): StepResult {
  return { state, effects: [{ kind: 'reject', connectionId, correlationId, reason, view }] };
}

/**
 * Run the room out after a completed match: `Live → Complete → Persisted`. The
 * `Persisted` transition is an **explicit inert placeholder** in this slice — it
 * performs no durable write (real persistence + result emission is slice #6). The
 * engine `State` is retained so the final views already broadcast remain valid;
 * release happens at disposal.
 */
function completeAndPersist(state: RoomCoreState): RoomCoreState {
  const complete = advanceLifecycle(state.lifecycle, 'Complete');
  if (complete === null) {
    return state;
  }
  // Inert: no durable write here. Slice #6 owns the persistence + reveal payload.
  const persisted = advanceLifecycle(complete, 'Persisted');
  return { ...state, lifecycle: persisted ?? complete };
}

/**
 * Handle a connection leaving. Before the room goes `Live`, a leaving seat is freed
 * (and the room reverts to `Reserved` if it empties). Once `Live`, leaving is a no-op
 * here — disconnect/reconnect/abandonment handling is a later slice (#4).
 */
export function leaveRoom(state: RoomCoreState, connectionId: string): StepResult {
  if (state.lifecycle !== 'Filling') {
    return { state, effects: [] };
  }
  const seats = state.seats.filter((seat) => seat.connectionId !== connectionId);
  if (seats.length === state.seats.length) {
    return { state, effects: [] };
  }
  const lifecycle = seats.length === 0 ? 'Reserved' : state.lifecycle;
  return { state: { ...state, seats, lifecycle }, effects: [] };
}

/**
 * Dispose the room: release the engine state and reject all further input (spec:
 * "Room disposal"). Disposal follows the lifecycle machine — legal from a pre-live
 * room (never filled) or from `Persisted` after a completed match; an out-of-order
 * disposal (e.g. mid-`Live`) is rejected and leaves the room unchanged.
 */
export function disposeRoom(state: RoomCoreState): StepResult {
  const disposed = advanceLifecycle(state.lifecycle, 'Disposed');
  if (disposed === null) {
    return { state, effects: [] };
  }
  return { state: { ...state, lifecycle: 'Disposed', engine: null, handshake: null }, effects: [] };
}
