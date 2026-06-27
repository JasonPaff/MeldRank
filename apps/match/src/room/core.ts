import { createInitialState, reduce, viewFor, type FilteredView, type State, type TimeoutEvent } from '@meldrank/engine';
import { toHex, type SeatContribution } from '@meldrank/fairness';
import { hashVariant, REPLAY_FORMAT, REPLAY_SCHEMA_VERSION, type ReplayBlobV1, type VariantDefinition } from '@meldrank/shared';
import { advanceLifecycle } from './lifecycle';
import { isFull, lowestFreeSeat, isSeatOccupied, seatForConnection, withSeat } from './seating';
import { assembleAndDeal, openHand } from './handshake';
import { chargeElapsed, deadlineFor, grantBase, DEFAULT_CLOCK_CONFIG } from './clock';
import type {
  Clock,
  ClockConfig,
  Effect,
  HandRecord,
  IntentLogEntry,
  IntentRejectReason,
  JoinResult,
  MatchOutcome,
  MatchOutcomeLabel,
  MatchRecord,
  PendingDeadline,
  PlayerIntent,
  ResolutionReason,
  RoomCoreState,
  SeatClockSnapshot,
  SeatOutcome,
  SeatOutcomeLabel,
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
    resolution: null,
    record: { startedAt: null, hands: [], intents: [], reveals: [] },
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
 * The public clock snapshot for the room: the acting seat, its authoritative
 * deadline, and every seat's banks. The clocks are public, so every recipient sees
 * the same snapshot — `clockStateEffects` fans it to all seats, and `reconnect`
 * targets a single returning connection with it.
 */
function clockSnapshot(state: RoomCoreState): { actingSeat: number | null; deadline: number | null; seats: SeatClockSnapshot[] } {
  const acting = state.engine?.public.seatToAct ?? null;
  const actingClock = acting === null ? undefined : state.seats.find((seat) => seat.seatIndex === acting);
  const deadline =
    acting !== null && state.turnStartedAt !== null && actingClock !== undefined ? deadlineFor(state.turnStartedAt, actingClock) : null;
  const seats: SeatClockSnapshot[] = state.seats.map((seat) => ({
    seat: seat.seatIndex,
    remainingBaseMs: seat.remainingBaseMs,
    remainingReserveMs: seat.remainingReserveMs,
  }));
  return { actingSeat: acting, deadline, seats };
}

/**
 * One `clockState` effect per seated connection (spec: "Per-seat clock state
 * broadcast"). Each carries the acting seat, its authoritative deadline, and every
 * seat's banks — the clocks are public, so each recipient receives the same snapshot.
 */
function clockStateEffects(state: RoomCoreState): Effect[] {
  const snapshot = clockSnapshot(state);
  return state.seats.map((seat) => ({ kind: 'clockState', connectionId: seat.connectionId, ...snapshot }));
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

  // Harvest the per-hand record at the scoring boundary (design D1), before the next
  // hand resets the engine. `advanced` is immutable, so this reads the just-scored
  // hand's `handResult` / `contract` / `trump` / `scorePad` whether the match ends or
  // continues.
  if (advanced.public.phase === 'HandScoring' || advanced.public.phase === 'MatchComplete') {
    next = { ...next, record: { ...next.record, hands: [...next.record.hands, harvestHand(advanced)] } };
  }

  if (advanced.public.phase === 'MatchComplete') {
    const completed = completeMatch(next, now);
    next = completed.state;
    effects.push(...completed.effects);
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
 * Extract a plain {@link HandRecord} from the engine state resting at the scoring
 * boundary (design D1): the bidding context from `contract`, the made/set verdict and
 * per-side lines from `handResult`, the running cumulative-by-side from `scorePad`,
 * and the 1-based hand number from the scorepad's hand count. The shape mirrors
 * `ProjectHandInput`, so the writer feeds it straight to `projectHand()`.
 */
function harvestHand(engine: State): HandRecord {
  const pub = engine.public;
  const contract = pub.contract!;
  const result = pub.handResult!;
  return {
    handNumber: pub.scorePad.hands.length,
    bidderSeat: contract.seatIndex,
    contractValue: contract.value,
    trump: pub.trump!,
    made: result.made,
    lines: result.lines.map((line) => ({ side: line.side, meld: line.meld, counters: line.counters, total: line.total })),
    cumulativeBySide: { ...pub.scorePad.cumulative },
  };
}

/**
 * Close the contribution window and deal (design D5): assemble the seed over the
 * committed server seed and the collected contributions (deterministic fallback for
 * absent seats), clear the handshake and its deadline, stamp the first seat's turn,
 * and broadcast each seat's dealt view plus the opening clock state.
 */
function dealAndBroadcast(state: RoomCoreState, now: number): StepResult {
  const handshake = state.handshake!;
  const dealt = assembleAndDeal(state.engine!, handshake, state.seatCount);
  // Capture this hand's seed reveal before the handshake is discarded (design D1):
  // the nonce, server seed, commitment, and seat contributions that determined the
  // deal. Replay-only — it surfaces only inside the durable blob written at match end.
  const reveal = {
    handNonce: handshake.handNonce,
    serverSeed: handshake.serverSeed,
    commit: handshake.commit,
    contributions: handshake.contributions.map((c) => ({ seat: c.seat, clientSeed: c.clientSeed })),
  };
  let afterDeal: RoomCoreState = {
    ...state,
    engine: dealt,
    handshake: null,
    contributionDeadline: null,
    record: { ...state.record, reveals: [...state.record.reveals, reveal] },
  };
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
    // The room goes Live: stamp the record's start instant (design D1) and begin the
    // first hand. The single `clock()` read is reused for both so they agree.
    const liveAt = clock();
    next = {
      ...next,
      lifecycle: advanceLifecycle(next.lifecycle, 'Live')!,
      record: { ...next.record, startedAt: liveAt },
    };
    const began = beginHand(next, seed, liveAt);
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
 * completes the room advances to `Complete` and emits a `persist` effect.
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
  // A resolved match (forfeit/abort) has left `Live` and accepts no further intents
  // (capability `match-disconnect-abandonment`, "Resolved room rejects further
  // intents"); the lifecycle guard below also covers it once it advances past `Live`.
  if (state.resolution !== null || state.lifecycle !== 'Live' || engine === null) {
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

  // Charge the acting seat for the time it held the turn, append the accepted intent
  // to the ordered log (design D1, replay-only), then advance/broadcast and grant the
  // next acting seat its fresh base — the shared tail keeps the player and timeout
  // paths identical (design D4).
  const charged = appendIntent(chargeActingSeat(state, now), { seat, intent, forcedTimeout: false });
  return applyAdvanceBroadcast(charged, advanced, now, seed, baseEffects);
}

/** Append one entry to the ordered intent log (design D1), returning the next state. */
function appendIntent(state: RoomCoreState, entry: IntentLogEntry): RoomCoreState {
  return { ...state, record: { ...state.record, intents: [...state.record.intents, entry] } };
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

  // Ranked repeated-timeout abandonment (design D5; delta `match-move-clocks`): on
  // crossing the configured threshold the signal now *drives resolution* — the seat is
  // treated as a leaver and forfeits with reason `timeout_abandon`, rather than being
  // granted another forced move. The signal is still emitted for the leaver-penalty
  // hook's consumer; the forfeit runs the room out to its terminal lifecycle.
  if (state.ranked && timeoutCount >= state.config.timeoutAbandonThreshold) {
    const signal: Effect = { kind: 'abandonmentSignal', seat: acting, timeoutCount };
    const forfeit = resolveForfeit(zeroed, acting, 'timeout_abandon', now);
    return { state: forfeit.state, effects: [signal, ...forfeit.effects] };
  }

  const event: TimeoutEvent = { type: 'timeout', seat: acting };
  const advanced = reduce(engine, event);
  if (advanced === engine) {
    // No forced move was defined for this phase (TimeoutMove returned null). The
    // banks/tally still updated; nothing advances or broadcasts.
    return { state: zeroed, effects: [] };
  }

  // Record the forced timeout move in the ordered intent log (design D1, replay-only).
  const recorded = appendIntent(zeroed, { seat: acting, intent: null, forcedTimeout: true });
  return applyAdvanceBroadcast(recorded, advanced, now, seed, broadcastViews(recorded, advanced));
}

/**
 * The room's currently-pending deadline (design D2/D3), read by the adapter after
 * every step to (re)arm its single wall-clock timer: the **earliest** of the open
 * contribution window's close, the acting seat's turn expiry, and every disconnected
 * seat's reconnection grace deadline (each a candidate; the soonest wins). A `'grace'`
 * winner carries its `seat` so the adapter routes the fire to `expireGrace`. Returns
 * `null` when nothing is on the clock. This naturally implements "wait out the shorter
 * of (grace, move clock)" with no special-casing — the concurrent deadlines simply
 * compete.
 */
export function pendingDeadline(state: RoomCoreState): PendingDeadline | null {
  if (state.lifecycle !== 'Live' || state.engine === null) {
    return null;
  }
  const candidates: PendingDeadline[] = [];

  if (state.handshake !== null && state.contributionDeadline !== null) {
    candidates.push({ at: state.contributionDeadline, kind: 'contribution' });
  }

  const acting = state.engine.public.seatToAct;
  if (acting !== null && state.turnStartedAt !== null) {
    const actingClock = state.seats.find((s) => s.seatIndex === acting);
    if (actingClock !== undefined) {
      candidates.push({ at: deadlineFor(state.turnStartedAt, actingClock), kind: 'turn' });
    }
  }

  for (const seat of state.seats) {
    if (seat.connectionStatus === 'Disconnected' && seat.graceDeadline !== null) {
      candidates.push({ at: seat.graceDeadline, kind: 'grace', seat: seat.seatIndex });
    }
  }

  if (candidates.length === 0) {
    return null;
  }
  return candidates.reduce((earliest, candidate) => (candidate.at < earliest.at ? candidate : earliest));
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
 * Complete a finished match (design D2; capability `match-persistence`): advance
 * `Live → Complete` **only**, assemble the full {@link MatchRecord}, and emit exactly
 * one `persist` effect carrying it. The pure core does **not** advance to `Persisted`
 * and performs no IO — the adapter owns the durable write and the
 * `Complete → Persisted` advance via {@link markPersisted}. The engine `State` is
 * retained so the final views already broadcast remain valid; release is at disposal.
 *
 * Both completion paths funnel here: a naturally scored-out match (from
 * {@link applyAdvanceBroadcast}) and an abandonment resolution (from
 * {@link resolveForfeit} / {@link abortMatch}, which set `state.resolution` first).
 * An illegal transition (not from `Live`) is a no-op emitting nothing.
 */
function completeMatch(state: RoomCoreState, now: number): StepResult {
  const complete = advanceLifecycle(state.lifecycle, 'Complete');
  if (complete === null) {
    return { state, effects: [] };
  }
  const next: RoomCoreState = { ...state, lifecycle: complete };
  const record = assembleMatchRecord(next, now);
  return { state: next, effects: [{ kind: 'persist', record }] };
}

/**
 * Advance `Complete → Persisted` (design D2): called by the adapter only after the
 * durable write confirms. Disposal stays gated on `Persisted`. An illegal transition
 * (not from `Complete`) is a no-op, so a failed write that never calls this leaves the
 * room resting at `Complete`.
 */
export function markPersisted(state: RoomCoreState): StepResult {
  const persisted = advanceLifecycle(state.lifecycle, 'Persisted');
  if (persisted === null) {
    return { state, effects: [] };
  }
  return { state: { ...state, lifecycle: persisted }, effects: [] };
}

/**
 * Assemble the complete {@link MatchRecord} from the room state at completion
 * (design D2/D3/D4). Derives the self-describing envelope (mode/status/reason +
 * variant snapshot & hash), carries the per-hand `HandRecord`s, computes the per-seat
 * normalized outcomes, and builds the versioned replay blob. Pure: the writer is left
 * to do nothing but the IO.
 *
 * The completion path is read from `state.resolution`: `null` is a played-out match
 * (outcomes from the engine's `matchResult.standings`); a set resolution is a forfeit
 * or abort (outcomes normalized from the resolution's labels).
 */
function assembleMatchRecord(state: RoomCoreState, completedAt: number): MatchRecord {
  const resolution = state.resolution;
  let status: 'complete' | 'aborted';
  let resolutionReason: MatchRecord['match']['resolutionReason'];
  let outcomes: MatchOutcome[];
  if (resolution === null) {
    status = 'complete';
    resolutionReason = 'played_out';
    outcomes = playedOutOutcomes(state);
  } else {
    resolutionReason = resolution.reason;
    status = resolution.reason === 'aborted' ? 'aborted' : 'complete';
    outcomes = resolution.outcomes.map((o) => ({ seat: o.seat, outcome: normalizeOutcome(o.outcome) }));
  }

  return {
    match: {
      mode: state.ranked ? 'ranked' : 'casual',
      status,
      resolutionReason,
      // Ad-hoc casual: no registry id/version yet (design D4). The snapshot + hash
      // keep the match self-describing without one.
      variantId: null,
      variantVersion: null,
      variantSnapshot: state.variant,
      variantHash: hashVariant(state.variant),
      startedAt: state.record.startedAt,
      completedAt,
    },
    hands: state.record.hands,
    outcomes,
    replay: buildReplayBlob(state),
  };
}

/**
 * Per-seat normalized outcomes for a played-out match (design D3): map each seat to
 * its side via the variant partnership structure, then to that side's `win`/`loss`
 * standing from the engine's `MatchScorer` result. A seat whose side has no standing
 * (degenerate) falls back to `no_result`.
 */
function playedOutOutcomes(state: RoomCoreState): MatchOutcome[] {
  const standings = state.engine!.public.matchResult!.standings;
  const bySide = new Map<number, MatchOutcomeLabel>(standings.map((s) => [s.side, s.outcome]));
  const outcomes: MatchOutcome[] = [];
  for (let seat = 0; seat < state.seatCount; seat++) {
    outcomes.push({ seat, outcome: bySide.get(sideOfSeat(state.variant, seat)) ?? 'no_result' });
  }
  return outcomes;
}

/**
 * The side (scoring group) a seat belongs to (design D3): the partnership's index in
 * `seating.teams.partnerships` for `partnerships`, or the seat index itself for
 * `free-for-all` — matching the engine's own `sideOfSeat`. For the canonical Partners
 * layout `[[0, 2], [1, 3]]` the partnership index is `0` for seats 0/2 and `1` for 1/3.
 */
function sideOfSeat(variant: VariantDefinition, seat: number): number {
  const teams = variant.seating.teams;
  if (teams.mode === 'free-for-all') {
    return seat;
  }
  return teams.partnerships.findIndex((group) => group.includes(seat));
}

/**
 * Normalize a room abandonment label to the durable `participant_outcome` vocabulary
 * (design D3): `opponent_win → win`, `abandoner_loss` /
 * `stranded_partner_reduced_loss → loss`, `no_result → no_result`.
 */
function normalizeOutcome(label: SeatOutcomeLabel): MatchOutcomeLabel {
  switch (label) {
    case 'opponent_win':
      return 'win';
    case 'abandoner_loss':
    case 'stranded_partner_reduced_loss':
      return 'loss';
    case 'no_result':
      return 'no_result';
  }
}

/**
 * Build the versioned, JSON-safe replay blob (design D7) from the accumulator: the
 * variant snapshot, the per-hand summaries, the ordered intent log, and the seed
 * reveals with their `Uint8Array` bytes hex-encoded. Opaque once written — its meaning
 * is owned solely by the match runtime.
 */
function buildReplayBlob(state: RoomCoreState): ReplayBlobV1 {
  return {
    format: REPLAY_FORMAT,
    schemaVersion: REPLAY_SCHEMA_VERSION,
    variant: state.variant,
    hands: state.record.hands.map((hand) => ({
      handNumber: hand.handNumber,
      bidderSeat: hand.bidderSeat,
      contractValue: hand.contractValue,
      trump: hand.trump,
      made: hand.made,
      lines: hand.lines.map((line) => ({ side: line.side, meld: line.meld, counters: line.counters, total: line.total })),
      cumulativeBySide: { ...hand.cumulativeBySide },
    })),
    intents: state.record.intents.map((entry) => ({ seat: entry.seat, forcedTimeout: entry.forcedTimeout, intent: entry.intent })),
    reveals: state.record.reveals.map((reveal) => ({
      handNonce: reveal.handNonce,
      serverSeed: toHex(reveal.serverSeed),
      commit: toHex(reveal.commit),
      contributions: reveal.contributions.map((c) => ({ seat: c.seat, clientSeed: toHex(c.clientSeed) })),
    })),
  };
}

/**
 * The abandoner's partner seat per the variant's partnership structure (design D6):
 * the other seat in the partnership group containing `seat`. Returns `null` for
 * partnerless variants (Cutthroat / free-for-all), where every non-abandoner is an
 * opponent and there is no stranded partner. Ranked v1 only exercises the Partners
 * path; the helper is written generally so a future ≥3-per-team variant still resolves.
 */
function partnerOf(variant: VariantDefinition, seat: number): number | null {
  const teams = variant.seating.teams;
  if (teams.mode !== 'partnerships') {
    return null;
  }
  for (const group of teams.partnerships) {
    if (group.includes(seat)) {
      const partner = group.find((member) => member !== seat);
      return partner ?? null;
    }
  }
  return null;
}

/**
 * Resolve a ranked abandonment as a **forfeit** (design D5; capability
 * `match-disconnect-abandonment`). Both forfeit triggers — grace expiry
 * (`forfeit_abandon`) and the repeated-timeout threshold (`timeout_abandon`) — funnel
 * here so they differ only in the `reason`. Per-seat outcome labels are computed from
 * the variant's partnership structure: the abandoner an `abandoner_loss`, its partner
 * a protected `stranded_partner_reduced_loss`, every opposing seat an `opponent_win`.
 * The resolution is recorded on the room and the room is completed (`Live → Complete`)
 * via {@link completeMatch}, emitting the `persist` effect alongside an
 * `abandonResolution` (the terminal result) and an `abandonEvent` (the leaver-penalty
 * hook identifying the abandoner). No bot is ever seated; the engine `State` is
 * untouched.
 */
function resolveForfeit(state: RoomCoreState, abandonerSeat: number, reason: ResolutionReason, now: number): StepResult {
  const partner = partnerOf(state.variant, abandonerSeat);
  const outcomes: SeatOutcome[] = [];
  for (let seat = 0; seat < state.seatCount; seat++) {
    if (seat === abandonerSeat) {
      outcomes.push({ seat, outcome: 'abandoner_loss' });
    } else if (seat === partner) {
      outcomes.push({ seat, outcome: 'stranded_partner_reduced_loss' });
    } else {
      outcomes.push({ seat, outcome: 'opponent_win' });
    }
  }
  const resolution = { reason, outcomes };
  const completed = completeMatch({ ...state, resolution }, now);
  const effects: Effect[] = [
    ...completed.effects,
    { kind: 'abandonResolution', reason, outcomes },
    { kind: 'abandonEvent', seat: abandonerSeat, reason },
  ];
  return { state: completed.state, effects };
}

/**
 * Abort the match with no rating change (design D7; capability
 * `match-disconnect-abandonment`, "Multi-drop and crash abort"). Used when two or more
 * ranked seats are past grace simultaneously and no legitimate single-forfeit result is
 * possible: every seat is assigned `no_result`, the resolution is recorded, and the room
 * is completed (`Live → Complete`) via {@link completeMatch}. The `persist` effect and an
 * `abandonResolution` are emitted — **no** `abandonEvent`, because no seat is charged —
 * and no winner is fabricated.
 */
function abortMatch(state: RoomCoreState, reason: ResolutionReason, now: number): StepResult {
  const outcomes: SeatOutcome[] = [];
  for (let seat = 0; seat < state.seatCount; seat++) {
    outcomes.push({ seat, outcome: 'no_result' });
  }
  const resolution = { reason, outcomes };
  const completed = completeMatch({ ...state, resolution }, now);
  return { state: completed.state, effects: [...completed.effects, { kind: 'abandonResolution', reason, outcomes }] };
}

/**
 * Resolve an expired reconnection grace window (design D7/D8; capability
 * `match-disconnect-abandonment`). A no-op unless the named seat is genuinely
 * `Disconnected` with its grace deadline passed (the early-fire guard lets the adapter
 * reschedule), and a no-op once the match has resolved or the room is no longer live.
 *
 * In a **ranked** room: if another seat is already past its grace window unresolved,
 * there is no legitimate single result, so the match `abortMatch`s; otherwise it
 * `resolveForfeit`s the abandoner with reason `forfeit_abandon`. A ranked room never
 * seats a bot.
 *
 * In a **casual** room: the seat is marked `BotControlled` and a `botTakeoverRequested`
 * effect is emitted (the stubbed seating contract — slice #5 wires the real bot worker);
 * the match is **not** resolved, and the returning human can reclaim the seat via
 * `reconnect`. A `BotControlled` seat still runs its move clock (no bot acts yet).
 */
export function expireGrace(state: RoomCoreState, seat: number, clock: Clock, seed: ServerSeedSource): StepResult {
  void seed; // resolution does not deal a new hand; the seam matches the other timer entrypoints.
  const now = clock();
  if (state.resolution !== null || state.lifecycle !== 'Live' || state.engine === null) {
    return { state, effects: [] };
  }
  const assignment = state.seats.find((s) => s.seatIndex === seat);
  if (assignment === undefined || assignment.connectionStatus !== 'Disconnected' || assignment.graceDeadline === null) {
    return { state, effects: [] };
  }
  // Early-fire guard: if the grace deadline has not actually passed, do nothing and let
  // the adapter re-arm its timer from the recomputed deadline (the established pattern).
  if (now < assignment.graceDeadline) {
    return { state, effects: [] };
  }

  if (state.ranked) {
    const anotherPastGrace = state.seats.some(
      (s) => s.seatIndex !== seat && s.connectionStatus === 'Disconnected' && s.graceDeadline !== null && now >= s.graceDeadline,
    );
    if (anotherPastGrace) {
      return abortMatch(state, 'aborted', now);
    }
    return resolveForfeit(state, seat, 'forfeit_abandon', now);
  }

  // Casual: hand the seat to the stubbed bot-takeover seating contract, do not resolve.
  const seats = state.seats.map((s) =>
    s.seatIndex === seat ? { ...s, connectionStatus: 'BotControlled' as const, graceDeadline: null } : s,
  );
  return { state: { ...state, seats }, effects: [{ kind: 'botTakeoverRequested', seat }] };
}

/**
 * Handle a connection leaving (capability `match-disconnect-abandonment`,
 * "Disconnect detection and grace window"). Before the room goes `Live`, a leaving
 * seat is freed (and the room reverts to `Reserved` if it empties) exactly as before
 * this slice. Once `Live`, the seat is **not** freed: it is marked `Disconnected` and
 * stamped a server-authoritative grace deadline (`now + config.reconnectGraceMs`),
 * leaving the seat assignment and the engine `State` untouched so the seat can be
 * reclaimed. The grace deadline becomes a pending-deadline candidate; the adapter
 * arms its timer and routes the eventual fire to `expireGrace`.
 */
export function leaveRoom(state: RoomCoreState, connectionId: string, clock: Clock): StepResult {
  if (state.lifecycle === 'Live') {
    const now = clock();
    let changed = false;
    const seats = state.seats.map((seat) => {
      if (seat.connectionId !== connectionId || seat.connectionStatus !== 'Connected') {
        return seat;
      }
      changed = true;
      return { ...seat, connectionStatus: 'Disconnected' as const, graceDeadline: now + state.config.reconnectGraceMs };
    });
    if (!changed) {
      return { state, effects: [] };
    }
    return { state: { ...state, seats }, effects: [] };
  }

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
 * Reconnect a dropped seat within its grace window (design D4; capability
 * `match-disconnect-abandonment`, "Reconnection within grace resyncs the seat"). The
 * seat is found by its stable `token` (the join-time identity that survives a new
 * transport session), its `connectionId` rewritten to the new connection, its grace
 * deadline cleared, and its status restored to `Connected` (also from a casual
 * `BotControlled` takeover). The returning connection is pushed a full authoritative
 * resync — its `viewFor` view plus the current clock state — so it renders the live
 * table without replaying incremental messages. The engine `State` is untouched. A
 * no-op once the match has resolved (a resolved seat is never restored) or the room
 * is no longer live, or when no seat matches the token.
 */
export function reconnect(state: RoomCoreState, token: string, newConnectionId: string, clock: Clock): StepResult {
  void clock; // reconnection does not read the clock; the seam is kept for symmetry/future use.
  if (state.resolution !== null || state.lifecycle !== 'Live' || state.engine === null) {
    return { state, effects: [] };
  }
  const assignment = state.seats.find((seat) => seat.token === token);
  if (assignment === undefined) {
    return { state, effects: [] };
  }
  const seats = state.seats.map((seat) =>
    seat.token === token ? { ...seat, connectionId: newConnectionId, connectionStatus: 'Connected' as const, graceDeadline: null } : seat,
  );
  const next: RoomCoreState = { ...state, seats };
  const effects: Effect[] = [
    { kind: 'view', connectionId: newConnectionId, view: safeView(next.engine!, assignment.seatIndex) },
    { kind: 'clockState', connectionId: newConnectionId, ...clockSnapshot(next) },
  ];
  return { state: next, effects };
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
