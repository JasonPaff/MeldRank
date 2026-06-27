import { describe, expect, it } from 'vitest';
import { SINGLE_DECK_PARTNERS } from '@meldrank/shared';
import {
  createRoomCore,
  disposeRoom,
  expireClock,
  expireGrace,
  joinRoom,
  leaveRoom,
  pendingDeadline,
  reconnect,
  submitContribution,
} from './core';
import { DEFAULT_CLOCK_CONFIG } from './clock';
import type { Clock, Effect, RoomCoreState, ServerSeedSource } from './types';

/**
 * Disconnect / reconnect / abandonment (capability `match-disconnect-abandonment`).
 * Every step is a pure `RoomCore` function over an injected clock, so the grace
 * window, the concurrent deadlines, and the forfeit/abort/takeover resolutions are
 * exercised deterministically with no transport.
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

/** A fixed clock anchored at 0; the deal stamps the first turn at t = 0. */
const clock: Clock = () => 0;

/** The reconnection grace window from the default profile. */
const GRACE = DEFAULT_CLOCK_CONFIG.reconnectGraceMs;

/** The connection id seated at `seat`. */
function connFor(state: RoomCoreState, seat: number): string {
  return state.seats.find((s) => s.seatIndex === seat)!.connectionId;
}

/** The variant's partner seat for `seat` ([[0,2],[1,3]] → opposite seat). */
function partnerSeat(seat: number): number {
  return (seat + 2) % 4;
}

/** Boot a Live Partners room dealt to Auction (one seat on the clock). */
function bootDealt(opts: { ranked?: boolean } = {}, c: Clock = clock): RoomCoreState {
  const seed = fixedSeeder();
  let state = createRoomCore(SINGLE_DECK_PARTNERS, { ranked: opts.ranked ?? false });
  const count = SINGLE_DECK_PARTNERS.seating.playerCount;
  for (let i = 0; i < count; i++) state = joinRoom(state, `conn-${i}`, seed, c).state;
  for (let i = 0; i < count; i++) state = submitContribution(state, `conn-${i}`, clientSeed(i), c).state;
  return state;
}

/** Boot a still-`Filling` room (one seat short of the variant's count). */
function bootFilling(): RoomCoreState {
  const seed = fixedSeeder();
  let state = createRoomCore(SINGLE_DECK_PARTNERS);
  const count = SINGLE_DECK_PARTNERS.seating.playerCount;
  for (let i = 0; i < count - 1; i++) state = joinRoom(state, `conn-${i}`, seed, clock).state;
  return state;
}

describe('grace window lifecycle (task 5.1)', () => {
  it('marks a Live drop Disconnected and stamps its grace deadline', () => {
    const state = bootDealt();
    const dropAt = 1_000;
    const result = leaveRoom(state, connFor(state, 0), () => dropAt);

    const seat = result.state.seats.find((s) => s.seatIndex === 0)!;
    expect(seat.connectionStatus).toBe('Disconnected');
    expect(seat.graceDeadline).toBe(dropAt + GRACE);
    // The seat assignment is retained and the engine State is unchanged.
    expect(result.state.seats).toHaveLength(SINGLE_DECK_PARTNERS.seating.playerCount);
    expect(result.state.engine).toBe(state.engine);
    expect(result.effects).toHaveLength(0);
  });

  it('uses the configured grace duration', () => {
    const seed = fixedSeeder();
    let state = createRoomCore(SINGLE_DECK_PARTNERS, { clock: { reconnectGraceMs: 30_000 } });
    const count = SINGLE_DECK_PARTNERS.seating.playerCount;
    for (let i = 0; i < count; i++) state = joinRoom(state, `conn-${i}`, seed, clock).state;
    for (let i = 0; i < count; i++) state = submitContribution(state, `conn-${i}`, clientSeed(i), clock).state;

    const result = leaveRoom(state, connFor(state, 0), () => 5_000);
    expect(result.state.seats.find((s) => s.seatIndex === 0)!.graceDeadline).toBe(35_000);
  });

  it('still frees a pre-Live (Filling) seat without a grace window', () => {
    const state = bootFilling();
    expect(state.lifecycle).toBe('Filling');
    const before = state.seats.length;

    const result = leaveRoom(state, connFor(state, 0), clock);
    expect(result.state.seats.length).toBe(before - 1);
    expect(result.state.seats.some((s) => s.seatIndex === 0)).toBe(false);
    expect(result.state.seats.every((s) => s.connectionStatus === 'Connected')).toBe(true);
  });

  it('restores and resyncs a seat that reconnects within grace, keyed by token', () => {
    const state = bootDealt();
    const token = state.seats.find((s) => s.seatIndex === 0)!.token;
    const dropped = leaveRoom(state, connFor(state, 0), () => 1_000).state;

    const result = reconnect(dropped, token, 'conn-0-new', clock);
    const seat = result.state.seats.find((s) => s.seatIndex === 0)!;
    expect(seat.connectionStatus).toBe('Connected');
    expect(seat.graceDeadline).toBeNull();
    expect(seat.connectionId).toBe('conn-0-new'); // new transport session, same seat index
    expect(seat.seatIndex).toBe(0);
    // The engine State is untouched by the reconnection.
    expect(result.state.engine).toBe(dropped.engine);
    // A full resync to the new connection: its own FilteredView plus the clock state.
    const view = result.effects.find((e) => e.kind === 'view');
    const clockState = result.effects.find((e) => e.kind === 'clockState');
    expect(view).toMatchObject({ kind: 'view', connectionId: 'conn-0-new' });
    expect(clockState).toMatchObject({ kind: 'clockState', connectionId: 'conn-0-new' });
  });

  it('does not honor a reconnection into a resolved match', () => {
    const state = bootDealt({ ranked: true });
    const token = state.seats.find((s) => s.seatIndex === 0)!.token;
    const dropped = leaveRoom(state, connFor(state, 0), () => 0).state;
    const resolved = expireGrace(dropped, 0, () => GRACE, fixedSeeder()).state;
    expect(resolved.resolution).not.toBeNull();

    const result = reconnect(resolved, token, 'conn-0-new', clock);
    expect(result.state).toBe(resolved); // unchanged
    expect(result.effects).toHaveLength(0);
    expect(result.state.seats.find((s) => s.seatIndex === 0)!.connectionStatus).toBe('Disconnected');
  });
});

describe('concurrent move clock and grace (task 5.2)', () => {
  it('reports the earliest of the turn expiry and a grace deadline', () => {
    const state = bootDealt();
    const acting = state.engine!.public.seatToAct!;
    const nonActing = (acting + 1) % SINGLE_DECK_PARTNERS.seating.playerCount;
    // Drop a non-acting seat at t=0: grace = 90_000, well before the acting seat's
    // turn expiry (0 + base 20_000 + reserve 90_000 = 110_000).
    const dropped = leaveRoom(state, connFor(state, nonActing), () => 0).state;

    const pending = pendingDeadline(dropped);
    expect(pending).toEqual({ at: GRACE, kind: 'grace', seat: nonActing });
  });

  it('lets the move clock fire first, leaving the disconnected seat in grace', () => {
    const state = bootDealt();
    const acting = state.engine!.public.seatToAct!;
    const nonActing = (acting + 1) % SINGLE_DECK_PARTNERS.seating.playerCount;
    // Drop the non-acting seat late so its grace (120_000) is after the turn (110_000).
    const dropped = leaveRoom(state, connFor(state, nonActing), () => 30_000).state;
    expect(pendingDeadline(dropped)).toMatchObject({ at: 110_000, kind: 'turn' });

    const result = expireClock(dropped, () => 110_000, fixedSeeder());
    // The move clock resolved through the forced-move policy (engine advanced)…
    expect(result.state.engine).not.toBe(dropped.engine);
    // …and the disconnected seat's grace window still runs.
    const seat = result.state.seats.find((s) => s.seatIndex === nonActing)!;
    expect(seat.connectionStatus).toBe('Disconnected');
    expect(seat.graceDeadline).toBe(120_000);
    expect(result.state.resolution).toBeNull();
  });

  it('lets a grace deadline fire first and resolve the match', () => {
    const state = bootDealt({ ranked: true });
    const acting = state.engine!.public.seatToAct!;
    const dropped = leaveRoom(state, connFor(state, acting), () => 0).state;
    // The acting seat's grace (90_000) precedes its turn (110_000).
    expect(pendingDeadline(dropped)).toMatchObject({ at: GRACE, kind: 'grace', seat: acting });

    const result = expireGrace(dropped, acting, () => GRACE, fixedSeeder());
    expect(result.state.resolution).not.toBeNull();
    expect(result.state.resolution!.reason).toBe('forfeit_abandon');
  });
});

describe('ranked forfeit (task 5.3)', () => {
  it('resolves a grace expiry as forfeit_abandon with per-seat outcomes', () => {
    const state = bootDealt({ ranked: true });
    const abandoner = 0;
    const dropped = leaveRoom(state, connFor(state, abandoner), () => 0).state;

    const result = expireGrace(dropped, abandoner, () => GRACE, fixedSeeder());

    expect(result.state.resolution!.reason).toBe('forfeit_abandon');
    const outcomes = result.state.resolution!.outcomes;
    expect(outcomes.find((o) => o.seat === abandoner)!.outcome).toBe('abandoner_loss');
    expect(outcomes.find((o) => o.seat === partnerSeat(abandoner))!.outcome).toBe('stranded_partner_reduced_loss');
    for (const seat of [1, 3]) {
      expect(outcomes.find((o) => o.seat === seat)!.outcome).toBe('opponent_win');
    }
    // The abandon event fires for the leaver-penalty layer, identifying the seat.
    const event = result.effects.find((e): e is Extract<Effect, { kind: 'abandonEvent' }> => e.kind === 'abandonEvent');
    expect(event).toMatchObject({ seat: abandoner, reason: 'forfeit_abandon' });
    // The resolution effect carries the reason + outcomes.
    expect(result.effects.some((e) => e.kind === 'abandonResolution')).toBe(true);
    // The room ran out to its terminal lifecycle; no bot was seated; disposal releases it.
    expect(result.state.lifecycle).toBe('Persisted');
    expect(result.state.seats.every((s) => s.connectionStatus !== 'BotControlled')).toBe(true);
    expect(disposeRoom(result.state).state.lifecycle).toBe('Disposed');
  });

  it('resolves a crossed timeout threshold as timeout_abandon through the same path', () => {
    const seed = fixedSeeder();
    let state = createRoomCore(SINGLE_DECK_PARTNERS, { ranked: true, clock: { timeoutAbandonThreshold: 1 } });
    const count = SINGLE_DECK_PARTNERS.seating.playerCount;
    for (let i = 0; i < count; i++) state = joinRoom(state, `conn-${i}`, seed, clock).state;
    for (let i = 0; i < count; i++) state = submitContribution(state, `conn-${i}`, clientSeed(i), clock).state;
    const actor = state.engine!.public.seatToAct!;

    const result = expireClock(state, () => 1_000_000, seed);

    // The signal is still emitted for the leaver-penalty hook…
    const signal = result.effects.find((e): e is Extract<Effect, { kind: 'abandonmentSignal' }> => e.kind === 'abandonmentSignal');
    expect(signal).toMatchObject({ seat: actor, timeoutCount: 1 });
    // …and now drives a timeout_abandon forfeit with the same outcome assignment.
    expect(result.state.resolution!.reason).toBe('timeout_abandon');
    const outcomes = result.state.resolution!.outcomes;
    expect(outcomes.find((o) => o.seat === actor)!.outcome).toBe('abandoner_loss');
    expect(outcomes.find((o) => o.seat === partnerSeat(actor))!.outcome).toBe('stranded_partner_reduced_loss');
    expect(result.effects.some((e) => e.kind === 'abandonEvent')).toBe(true);
    expect(result.state.lifecycle).toBe('Persisted');
  });
});

describe('multi-drop abort (task 5.4)', () => {
  it('aborts with no_result and no abandon event when two seats are past grace', () => {
    const state = bootDealt({ ranked: true });
    let dropped = leaveRoom(state, connFor(state, 0), () => 0).state;
    dropped = leaveRoom(dropped, connFor(dropped, 1), () => 0).state;

    const result = expireGrace(dropped, 0, () => GRACE, fixedSeeder());

    expect(result.state.resolution!.reason).toBe('aborted');
    expect(result.state.resolution!.outcomes.every((o) => o.outcome === 'no_result')).toBe(true);
    // No seat is charged: no abandon event, no fabricated winner.
    expect(result.effects.some((e) => e.kind === 'abandonEvent')).toBe(false);
    expect(result.effects.some((e) => e.kind === 'abandonResolution')).toBe(true);
    const outcomes = result.state.resolution!.outcomes;
    expect(outcomes.some((o) => o.outcome === 'opponent_win')).toBe(false);
    expect(outcomes.some((o) => o.outcome === 'abandoner_loss')).toBe(false);
    expect(result.state.lifecycle).toBe('Persisted');
  });
});

describe('casual bot takeover (task 5.5)', () => {
  it('hands a casual grace expiry to a bot without resolving the match', () => {
    const state = bootDealt({ ranked: false });
    const dropped = leaveRoom(state, connFor(state, 0), () => 0).state;

    const result = expireGrace(dropped, 0, () => GRACE, fixedSeeder());

    expect(result.state.seats.find((s) => s.seatIndex === 0)!.connectionStatus).toBe('BotControlled');
    expect(result.effects).toEqual([{ kind: 'botTakeoverRequested', seat: 0 }]);
    // The match is neither forfeited nor aborted.
    expect(result.state.resolution).toBeNull();
    expect(result.state.lifecycle).toBe('Live');
  });

  it('lets the returning human reclaim and resync a bot-controlled seat', () => {
    const state = bootDealt({ ranked: false });
    const token = state.seats.find((s) => s.seatIndex === 0)!.token;
    const dropped = leaveRoom(state, connFor(state, 0), () => 0).state;
    const bot = expireGrace(dropped, 0, () => GRACE, fixedSeeder()).state;
    expect(bot.seats.find((s) => s.seatIndex === 0)!.connectionStatus).toBe('BotControlled');

    const result = reconnect(bot, token, 'conn-0-back', clock);
    const seat = result.state.seats.find((s) => s.seatIndex === 0)!;
    expect(seat.connectionStatus).toBe('Connected');
    expect(seat.connectionId).toBe('conn-0-back');
    expect(result.effects.some((e) => e.kind === 'view')).toBe(true);
  });
});
