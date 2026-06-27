import { createInitialState, reduce, viewFor, type FilteredView, type State, type TimeoutEvent } from '@meldrank/engine';
import type { SeatContribution } from '@meldrank/fairness';
import type { VariantDefinition } from '@meldrank/shared';
import { advanceLifecycle } from './lifecycle';
import { isFull, lowestFreeSeat, isSeatOccupied, seatForConnection, withSeat } from './seating';
import { assembleAndDeal, openHand } from './handshake';
import { chargeElapsed, deadlineFor, grantBase, DEFAULT_CLOCK_CONFIG } from './clock';
import type {
  Clock,
  ClockConfig,
  Effect,
  IntentRejectReason,
  JoinResult,
  PendingDeadline,
  PlayerIntent,
  RoomCoreState,
  SeatClockSnapshot,
  ServerSeedSource,
  StepResult,
} from './types';

/**
 * The pure `RoomCore` (design D2): the room lifecycle machine plus the authoritative
 * `validate → apply → advance → broadcast` intent loop, expressed as a set of pure
 * functions returning `{ state, effects }`. The Colyseus `Room` is a thin adapter
 * that calls these and performs the sends; nothing here touches a socket, a clock,
 * or a database, so the integrity-critical loop is fully unit-testable. The server
 * holds the engine `State` whole; clients only ever receive per-seat `viewFor`
 * projections carried on the emitted effects (design D1).
 */

/** Options for {@link createRoomCore}: ranked gating and clock-config overrides. */
export interface CreateRoomOptions {
  /** Ranked rooms emit the abandonment signal (design D7); defaults to casual. */
  readonly ranked?: boolean;
  /** Override any subset of the move-clock config; the rest fall back to the default. */
  readonly clock?: Partial<ClockConfig>;
}

/**
 * Construct a room from its variant. The single authoritative engine `State` is
 * built here via `createInitialState` (spec: "Room constructs its engine state on
 * creation"); no card-bearing state exists until a hand is dealt. The move-clock
 * config (design D6) is the locked default unless overridden, and the room is casual
 * unless `ranked` is set; the room is timeless until the first deal stamps a turn.
 */
export function createRoomCore(variant: VariantDefinition, options: CreateRoomOptions = {}): RoomCoreState {
  return {
    lifecycle: 'Reserved',
    variant,
    seatCount: variant.seating.playerCount,
    seats: [],
    engine: createInitialState(variant),
    handshake: null,
    handsDealt: 0,
    config: { ...DEFAULT_CLOCK_CONFIG, ...options.clock },
    ranked: options.ranked ?? false,
    turnStartedAt: null,
    contributionDeadline: null,
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
 * server seed is drawn from the injected source and never leaves the server. The
 * contribution window's deadline is stamped from the injected `now` (design D5), and
 * no seat is on the move clock until the deal lands.
 */
function beginHand(state: RoomCoreState, seed: ServerSeedSource, now: number): StepResult {
  const { engine, handshake } = openHand(state.engine!, state.handsDealt, seed());
  const next: RoomCoreState = {
    ...state,
    engine,
    handshake,
    handsDealt: state.handsDealt + 1,
    contributionDeadline: now + state.config.contributionWindowMs,
    turnStartedAt: null,
  };
  const effects: Effect[] = next.seats.map((seat) => ({
    kind: 'commit',
    connectionId: seat.connectionId,
    handNonce: handshake.handNonce,
    commit: handshake.commit,
  }));
  return { state: next, effects };
}

/**
 * Charge the currently-acting seat for the time it has held the turn (design D2):
 * `elapsed = now - turnStartedAt` deducted from its base then reserve. A no-op when
 * no seat is on the clock (e.g. a non-acting phase) or no turn has been stamped.
 */
function chargeActingSeat(state: RoomCoreState, now: number): RoomCoreState {
  const acting = state.engine?.public.seatToAct ?? null;
  if (acting === null || state.turnStartedAt === null) {
    return state;
  }
  const elapsed = now - state.turnStartedAt;
  const seats = state.seats.map((seat) => (seat.seatIndex === acting ? { ...seat, ...chargeElapsed(seat, elapsed) } : seat));
  return { ...state, seats };
}

/**
 * Stamp the turn for the engine's current seat-to-act (design D2): grant it a fresh
 * base allotment and record `turnStartedAt = now`. When no seat is on the clock the
 * turn is cleared (`turnStartedAt = null`) so the adapter arms no expiry.
 */
function stampTurn(state: RoomCoreState, now: number): RoomCoreState {
  const acting = state.engine?.public.seatToAct ?? null;
  if (acting === null) {
    return { ...state, turnStartedAt: null };
  }
  const seats = state.seats.map((seat) => (seat.seatIndex === acting ? { ...seat, ...grantBase(seat, state.config) } : seat));
  return { ...state, seats, turnStartedAt: now };
}

/**
 * One `clockState` effect per seated connection (spec: "Per-seat clock state
 * broadcast"). Each carries the acting seat, its authoritative deadline, and every
 * seat's banks — the clocks are public, so each recipient receives the same snapshot.
 */
function clockStateEffects(state: RoomCoreState): Effect[] {
  const acting = state.engine?.public.seatToAct ?? null;
  const actingClock = acting === null ? undefined : state.seats.find((seat) => seat.seatIndex === acting);
  const deadline =
    acting !== null && state.turnStartedAt !== null && actingClock !== undefined ? deadlineFor(state.turnStartedAt, actingClock) : null;
  const snapshots: SeatClockSnapshot[] = state.seats.map((seat) => ({
    seat: seat.seatIndex,
    remainingBaseMs: seat.remainingBaseMs,
    remainingReserveMs: seat.remainingReserveMs,
  }));
  return state.seats.map((seat) => ({
    kind: 'clockState',
    connectionId: seat.connectionId,
    actingSeat: acting,
    deadline,
    seats: snapshots,
  }));
}

/**
 * The shared post-`reduce` tail (design D4): given the advanced engine and the
 * already-charged acting seat, fold the new engine into the room state, run out a
 * completed match or open the next hand, stamp the new acting seat's turn, and append
 * the per-recipient clock-state broadcast to the supplied `baseEffects`. Both the
 * player-intent and the timeout paths funnel through here, so their broadcast
 * behaviour cannot diverge.
 */
function applyAdvanceBroadcast(
  state: RoomCoreState,
  advanced: State,
  now: number,
  seed: ServerSeedSource,
  baseEffects: Effect[],
): StepResult {
  let next: RoomCoreState = { ...state, engine: advanced, turnStartedAt: null };
  const effects: Effect[] = [...baseEffects];

  if (advanced.public.phase === 'MatchComplete') {
    next = completeAndPersist(next);
  } else if (advanced.public.phase === 'HandScoring') {
    // Hand finished, match continues: open the next hand's commit window.
    const began = beginHand(next, seed, now);
    next = began.state;
    effects.push(...began.effects);
  } else {
    next = stampTurn(next, now);
  }

  effects.push(...clockStateEffects(next));
  return { state: next, effects };
}

/**
 * Close the contribution window and deal (design D5): assemble the seed over the
 * committed server seed and the collected contributions (deterministic fallback for
 * absent seats), clear the handshake and its deadline, stamp the first seat's turn,
 * and broadcast each seat's dealt view plus the opening clock state.
 */
function dealAndBroadcast(state: RoomCoreState, now: number): StepResult {
  const dealt = assembleAndDeal(state.engine!, state.handshake!, state.seatCount);
  let afterDeal: RoomCoreState = { ...state, engine: dealt, handshake: null, contributionDeadline: null };
  afterDeal = stampTurn(afterDeal, now);
  const effects: Effect[] = [...broadcastViews(afterDeal, dealt), ...clockStateEffects(afterDeal)];
  return { state: afterDeal, effects };
}

/**
 * Seat a joining connection (spec: "Seat filling and identity"). Assigns the lowest
 * free seat (or a requested `desiredSeat`), rejecting a full room, an occupied target
 * seat, or a duplicate join. The joiner immediately receives a full authoritative
 * view for its seat (spec: "Full state resync on join"). When the join fills the
 * room, the lifecycle advances `Filling → Live` and the first hand begins (its commit
 * is broadcast to all seats).
 */
export function joinRoom(
  state: RoomCoreState,
  connectionId: string,
  seed: ServerSeedSource,
  clock: Clock,
  desiredSeat?: number,
): JoinResult {
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

  const seats = withSeat(state.seats, seatIndex, connectionId, state.config);
  const lifecycle = state.lifecycle === 'Reserved' ? advanceLifecycle('Reserved', 'Filling')! : state.lifecycle;
  let next: RoomCoreState = { ...state, seats, lifecycle };

  // Full resync to the newly seated connection (pre-deal: a public snapshot).
  const effects: Effect[] = [{ kind: 'view', connectionId, view: safeView(next.engine!, seatIndex) }];

  if (isFull(next)) {
    next = { ...next, lifecycle: advanceLifecycle(next.lifecycle, 'Live')! };
    const began = beginHand(next, seed, clock());
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
export function submitContribution(state: RoomCoreState, connectionId: string, clientSeed: Uint8Array, clock: Clock): StepResult {
  const now = clock();
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
  // Window deadline (design D5): once the contribution window has closed, the seat is
  // too late — the deal proceeds (or has proceeded) with the deterministic fallback.
  if (state.contributionDeadline !== null && now >= state.contributionDeadline) {
    return { state, effects: [{ kind: 'rejectContribution', connectionId, reason: 'window-closed' }] };
  }
  if (state.handshake.contributions.some((contribution) => contribution.seat === seat)) {
    return { state, effects: [{ kind: 'rejectContribution', connectionId, reason: 'already-contributed' }] };
  }

  const contribution: SeatContribution = { seat, clientSeed };
  const contributions = [...state.handshake.contributions, contribution];
  const handshake = { ...state.handshake, contributions };
  const next: RoomCoreState = { ...state, handshake };

  // Fast-path close (design D5): when every seated connection has contributed before
  // the deadline, close the window immediately and deal rather than waiting it out.
  if (contributions.length >= state.seatCount) {
    return dealAndBroadcast(next, now);
  }
  return { state: next, effects: [] };
}

/**
 * Close the contribution window on its deadline (design D5; spec: "Contribution
 * window closes on deadline"). A no-op while the room is not awaiting contributions
 * or the deadline has not yet passed (the adapter reschedules); otherwise it deals
 * with the deterministic fallback for any seat that never contributed. The fast-path
 * "everyone contributed early" close lives in {@link submitContribution}.
 */
export function closeContributionWindow(state: RoomCoreState, clock: Clock): StepResult {
  const now = clock();
  if (state.lifecycle !== 'Live' || state.engine === null || state.handshake === null) {
    return { state, effects: [] };
  }
  if (state.contributionDeadline !== null && now < state.contributionDeadline) {
    return { state, effects: [] };
  }
  return dealAndBroadcast(state, now);
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
  clock: Clock,
): StepResult {
  const now = clock();
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
  const baseEffects: Effect[] = [
    { kind: 'accept', connectionId, correlationId, view: viewFor(advanced, seat) },
    ...broadcastViewsExcept(state, advanced, connectionId),
  ];

  // Charge the acting seat for the time it held the turn, then advance/broadcast and
  // grant the next acting seat its fresh base — the shared tail keeps the player and
  // timeout paths identical (design D4).
  const charged = chargeActingSeat(state, now);
  return applyAdvanceBroadcast(charged, advanced, now, seed, baseEffects);
}

/**
 * Resolve an expired move clock (design D4; spec: "Timeout resolves via the engine
 * forced-move policy"). A no-op unless a seat is genuinely on the clock and its
 * deadline has passed (the early-fire guard lets the adapter reschedule). On expiry
 * it zeroes the acting seat's banks, tallies the timeout, injects the engine
 * `timeout` system event into `reduce` — which resolves the forced move through
 * `TimeoutMove` and the identical guards a player move passes — and runs the result
 * through the shared advance/broadcast tail. When the tally crosses the configured
 * threshold in a ranked room it also emits the abandonment signal (design D7); this
 * slice only signals — it does not forfeit or substitute the seat.
 */
export function expireClock(state: RoomCoreState, clock: Clock, seed: ServerSeedSource): StepResult {
  const now = clock();
  const engine = state.engine;
  if (state.lifecycle !== 'Live' || engine === null) {
    return { state, effects: [] };
  }
  const acting = engine.public.seatToAct;
  if (acting === null || state.turnStartedAt === null) {
    return { state, effects: [] };
  }
  const actingClock = state.seats.find((s) => s.seatIndex === acting);
  if (actingClock === undefined) {
    return { state, effects: [] };
  }
  // Early-fire guard (task 4.2): if the deadline has not actually passed, do nothing
  // and let the adapter re-arm its timer from the recomputed deadline.
  if (now < deadlineFor(state.turnStartedAt, actingClock)) {
    return { state, effects: [] };
  }

  // Zero the acting seat's banks (its time is fully spent) and tally the timeout.
  const timeoutCount = actingClock.timeoutCount + 1;
  const seats = state.seats.map((s) => (s.seatIndex === acting ? { ...s, remainingBaseMs: 0, remainingReserveMs: 0, timeoutCount } : s));
  const zeroed: RoomCoreState = { ...state, seats };

  // Abandonment signal (design D7): ranked-only, on crossing the configured threshold.
  const abandonment: Effect[] =
    state.ranked && timeoutCount >= state.config.timeoutAbandonThreshold ? [{ kind: 'abandonmentSignal', seat: acting, timeoutCount }] : [];

  const event: TimeoutEvent = { type: 'timeout', seat: acting };
  const advanced = reduce(engine, event);
  if (advanced === engine) {
    // No forced move was defined for this phase (TimeoutMove returned null). The
    // banks/tally still updated; nothing advances or broadcasts beyond the signal.
    return { state: zeroed, effects: abandonment };
  }

  const result = applyAdvanceBroadcast(zeroed, advanced, now, seed, broadcastViews(zeroed, advanced));
  return { state: result.state, effects: [...result.effects, ...abandonment] };
}

/**
 * The room's currently-pending deadline (design D3), read by the adapter after every
 * step to (re)arm its single wall-clock timer: the open contribution window's close
 * while a commit is awaiting contributions, otherwise the acting seat's turn expiry,
 * or `null` when nothing is on the clock.
 */
export function pendingDeadline(state: RoomCoreState): PendingDeadline | null {
  if (state.lifecycle !== 'Live' || state.engine === null) {
    return null;
  }
  if (state.handshake !== null && state.contributionDeadline !== null) {
    return { at: state.contributionDeadline, kind: 'contribution' };
  }
  const acting = state.engine.public.seatToAct;
  if (acting !== null && state.turnStartedAt !== null) {
    const actingClock = state.seats.find((s) => s.seatIndex === acting);
    if (actingClock !== undefined) {
      return { at: deadlineFor(state.turnStartedAt, actingClock), kind: 'turn' };
    }
  }
  return null;
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
