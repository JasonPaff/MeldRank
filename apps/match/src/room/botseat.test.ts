import { describe, expect, it } from 'vitest';
import { SINGLE_DECK_PARTNERS, type VariantDefinition } from '@meldrank/shared';
import { createRoomCore, joinRoom, seatBot, submitContribution, submitIntent } from './core';
import { botConnectionId } from './seating';
import type { Clock, RoomCoreState, ServerSeedSource } from './types';

/**
 * The pure-core seat-a-bot path (capability `bot-seating`, tasks 3.2–3.4): a bot is
 * a first-class `SeatAssignment` (synthetic connection + `isBot`), counts toward
 * fullness so a bot-filled room reaches `Live`, is refused in a ranked room, and its
 * intents pass the *identical* seat-ownership / turn / legality guards a human's do.
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

/** Seat `count` bots into a fresh casual room, returning the (possibly Live) state. */
function fillWithBots(variant: VariantDefinition, count: number, seed: ServerSeedSource): RoomCoreState {
  let state = createRoomCore(variant);
  for (let i = 0; i < count; i++) {
    state = seatBot(state, seed, clock).state;
  }
  return state;
}

/** Run the handshake over every (bot) seat so a hand is dealt. */
function deal(state: RoomCoreState): RoomCoreState {
  let next = state;
  for (const seat of state.seats) {
    next = submitContribution(next, seat.connectionId, clientSeed(seat.seatIndex), clock).state;
  }
  return next;
}

describe('seatBot — fullness and lifecycle', () => {
  const count = SINGLE_DECK_PARTNERS.seating.playerCount;

  it('fills the room to Live and begins the first hand', () => {
    const state = fillWithBots(SINGLE_DECK_PARTNERS, count, fixedSeeder());
    expect(state.seats).toHaveLength(count);
    expect(state.lifecycle).toBe('Live');
    // The first hand's commit window opened (a commit was broadcast per seat).
    expect(state.handshake).not.toBeNull();
    expect(state.handsDealt).toBe(1);
  });

  it('seats a bot as a normal assignment with a synthetic connection and the isBot marker', () => {
    const state = seatBot(createRoomCore(SINGLE_DECK_PARTNERS), fixedSeeder(), clock).state;
    expect(state.seats).toHaveLength(1);
    const seat = state.seats[0]!;
    expect(seat.seatIndex).toBe(0);
    expect(seat.connectionId).toBe(botConnectionId(0));
    expect(seat.isBot).toBe(true);
    expect(seat.connectionStatus).toBe('Connected');
  });

  it('lets a human and bots share a room and reach Live together', () => {
    const seed = fixedSeeder();
    let state = createRoomCore(SINGLE_DECK_PARTNERS);
    state = joinRoom(state, 'human-0', seed, clock).state;
    for (let i = 1; i < count; i++) {
      state = seatBot(state, seed, clock).state;
    }
    expect(state.lifecycle).toBe('Live');
    expect(state.seats.filter((s) => s.isBot)).toHaveLength(count - 1);
    expect(state.seats.find((s) => !s.isBot)!.connectionId).toBe('human-0');
  });

  it('refuses to seat a bot in a ranked room', () => {
    const ranked = createRoomCore(SINGLE_DECK_PARTNERS, { ranked: true });
    const result = seatBot(ranked, fixedSeeder(), clock);
    expect(result.outcome).toEqual({ status: 'rejected', reason: 'ranked' });
    expect(result.state.seats).toHaveLength(0);
  });

  it('refuses a bot when the room is full', () => {
    const full = fillWithBots(SINGLE_DECK_PARTNERS, count, fixedSeeder());
    const result = seatBot(full, fixedSeeder(), clock);
    expect(result.outcome).toEqual({ status: 'rejected', reason: 'room-full' });
  });
});

describe('seatBot — bot intents pass the same authority guards as a human', () => {
  it('accepts a legal bot intent for its own seat on its turn', () => {
    const seed = fixedSeeder();
    const dealt = deal(fillWithBots(SINGLE_DECK_PARTNERS, 4, seed));
    expect(dealt.engine!.public.phase).toBe('Auction');
    const actor = dealt.engine!.public.seatToAct!;

    const step = submitIntent(dealt, botConnectionId(actor), { type: 'pass', seat: actor }, 'c-0', seed, clock);
    // Accepted: the engine advanced and the turn moved on, exactly as for a human.
    expect(step.state.engine).not.toBe(dealt.engine);
    expect(step.effects.some((e) => e.kind === 'accept')).toBe(true);
  });

  it('rejects a bot intent claiming another seat (not-your-seat)', () => {
    const seed = fixedSeeder();
    const dealt = deal(fillWithBots(SINGLE_DECK_PARTNERS, 4, seed));
    const actor = dealt.engine!.public.seatToAct!;
    const other = (actor + 1) % 4;

    // The acting bot's connection submits an intent stamped for a different seat.
    const step = submitIntent(dealt, botConnectionId(actor), { type: 'pass', seat: other }, 'c-1', seed, clock);
    const reject = step.effects.find((e) => e.kind === 'reject');
    expect(reject).toMatchObject({ kind: 'reject', reason: 'not-your-seat' });
    expect(step.state).toBe(dealt); // nothing mutated
  });

  it('rejects an out-of-turn bot intent (out-of-turn)', () => {
    const seed = fixedSeeder();
    const dealt = deal(fillWithBots(SINGLE_DECK_PARTNERS, 4, seed));
    const actor = dealt.engine!.public.seatToAct!;
    const other = (actor + 1) % 4;

    // A non-acting bot submits for its own seat — blocked by turn authority.
    const step = submitIntent(dealt, botConnectionId(other), { type: 'pass', seat: other }, 'c-2', seed, clock);
    const reject = step.effects.find((e) => e.kind === 'reject');
    expect(reject).toMatchObject({ kind: 'reject', reason: 'out-of-turn' });
    expect(step.state).toBe(dealt);
  });
});
