import { describe, expect, it } from 'vitest';
import { SINGLE_DECK_PARTNERS, type VariantDefinition } from '@meldrank/shared';
import { LegalPlayValidator, viewFor } from '@meldrank/engine';
import { brain, type RandomSource } from '@meldrank/bots';
import {
  createRoomCore,
  expireGrace,
  joinRoom,
  leaveRoom,
  markPersisted,
  reconnect,
  seatBot,
  submitContribution,
  submitIntent,
} from './core';
import { botConnectionId, botSeatToDrive, engineActingSeat } from './seating';
import type { Clock, PlayerIntent, RoomCoreState, ServerSeedSource } from './types';

/**
 * End-to-end self-play (capability `bot-seating`, tasks 6.1–6.2): exercise the full
 * engine → room → bot → persistence spine at the pure-core + brain level (no Colyseus
 * timers, so it is deterministic). The room's bot-driver helper ({@link botSeatToDrive})
 * decides which seat the brain plays; the same `submitIntent` path a human uses carries
 * every move. We prove a 1-human + 3-bot Partners match plays to `Complete` and emits
 * the `persist` effect, that a casual disconnect-takeover lets the table finish, and
 * that a returning human reclaims the seat and stops bot driving.
 */

/** A Partners variant that ends after one hand, keeping self-play bounded. */
const PARTNERS_SHORT: VariantDefinition = { ...SINGLE_DECK_PARTNERS, matchEnd: { mode: 'target-score', target: 1 } };

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

/** A fixed clock anchored at 0; the deal stamps each turn at t = 0 (clocks never expire here). */
const clock: Clock = () => 0;

/**
 * A small deterministic PRNG (mulberry32) used as the bots' injected randomness, so
 * the whole self-play is reproducible while still varying bot choices enough for the
 * auction to terminate.
 */
function makeRng(seed: number): RandomSource {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A deterministic legal move for a stub human seat: pass / declare first suit / first legal card. */
function humanStub(state: RoomCoreState, seat: number, variant: VariantDefinition): PlayerIntent {
  const engine = state.engine!;
  switch (engine.public.phase) {
    case 'Auction':
      return { type: 'pass', seat };
    case 'DeclareTrump':
      return { type: 'declareTrump', seat, trump: variant.deck.suits[0]! };
    default: {
      const hand = engine.private.hands[seat]!;
      const legal = LegalPlayValidator(hand, engine.public.currentTrick, engine.public.trump!, variant.trick);
      const card = legal[0]!;
      return { type: 'playCard', seat, card: { rank: card.rank, suit: card.suit, copyIndex: card.copyIndex } };
    }
  }
}

interface SelfPlayResult {
  state: RoomCoreState;
  sawPersist: boolean;
  /** Per-seat count of turns driven through the bot brain. */
  botTurns: Map<number, number>;
}

/**
 * Drive a Live room to a terminal lifecycle. Each step: open the next deal by
 * contributing for every seat (fast-path close), then route the seat the engine
 * awaits — bot-driven seats through the brain, the rest through the human stub —
 * always via `submitIntent`.
 */
function selfPlay(start: RoomCoreState, seed: ServerSeedSource, variant: VariantDefinition, rng: RandomSource): SelfPlayResult {
  let state = start;
  let sawPersist = false;
  const botTurns = new Map<number, number>();
  for (let guard = 0; guard < 5000 && state.lifecycle === 'Live'; guard++) {
    // A fresh hand's commit window is open with no seat to act yet: contribute for
    // every seat so the deal closes immediately (the brain needs no entropy seam).
    if (state.handshake !== null && engineActingSeat(state) === null) {
      for (const s of state.seats) {
        state = submitContribution(state, s.connectionId, clientSeed(s.seatIndex), clock).state;
      }
      continue;
    }
    const actor = engineActingSeat(state);
    if (actor === null) {
      break;
    }
    const conn = state.seats.find((s) => s.seatIndex === actor)!.connectionId;
    const driveBot = botSeatToDrive(state) === actor;
    let intent: PlayerIntent;
    if (driveBot) {
      intent = brain(viewFor(state.engine!, actor), { seat: actor, variant, difficulty: 'medium', random: rng });
      botTurns.set(actor, (botTurns.get(actor) ?? 0) + 1);
    } else {
      intent = humanStub(state, actor, variant);
    }
    const step = submitIntent(state, conn, intent, `g-${guard}`, seed, clock);
    // A correct bot never has its intent rejected (legality is by construction).
    expect(step.effects.some((e) => e.kind === 'reject')).toBe(false);
    if (step.effects.some((e) => e.kind === 'persist')) {
      sawPersist = true;
    }
    state = step.state;
  }
  return { state, sawPersist, botTurns };
}

describe('bot self-play — 1 human + 3 bots (task 6.1)', () => {
  it('plays a full Single-Deck Partners match to Complete and emits the persist effect', () => {
    const seed = fixedSeeder();
    // Seat one stub human (seat 0) then fill the rest with bots → the room goes Live.
    let state = createRoomCore(PARTNERS_SHORT);
    state = joinRoom(state, 'human-0', seed, clock).state;
    while (state.seats.length < PARTNERS_SHORT.seating.playerCount) {
      state = seatBot(state, seed, clock).state;
    }
    expect(state.lifecycle).toBe('Live');
    expect(state.seats.filter((s) => s.isBot)).toHaveLength(3);

    const result = selfPlay(state, seed, PARTNERS_SHORT, makeRng(0x1234));

    // The spine self-played to completion and emitted the durable record.
    expect(result.state.lifecycle).toBe('Complete');
    expect(result.state.engine!.public.matchResult?.complete).toBe(true);
    expect(result.sawPersist).toBe(true);
    // Every bot seat actually drove turns through the brain (trick play guarantees it).
    for (const seat of [1, 2, 3]) {
      expect(result.botTurns.get(seat) ?? 0).toBeGreaterThan(0);
    }
    // The adapter would now confirm the write and advance the room.
    expect(markPersisted(result.state).state.lifecycle).toBe('Persisted');
  });
});

describe('casual disconnect-takeover (task 6.2)', () => {
  /** Boot a Live, dealt, all-human casual Partners room (short match). */
  function bootDealtHumans(seed: ServerSeedSource): RoomCoreState {
    let state = createRoomCore(PARTNERS_SHORT);
    const count = PARTNERS_SHORT.seating.playerCount;
    for (let i = 0; i < count; i++) state = joinRoom(state, `conn-${i}`, seed, clock).state;
    for (let i = 0; i < count; i++) state = submitContribution(state, `conn-${i}`, clientSeed(i), clock).state;
    return state;
  }

  it('a dropped human seat is taken over by the bot and the match completes', () => {
    const seed = fixedSeeder();
    let state = bootDealtHumans(seed);
    expect(state.engine!.public.phase).toBe('Auction');

    // Seat 2 drops; its casual grace expires → the seat is handed to the bot brain.
    state = leaveRoom(state, 'conn-2', clock).state;
    const expired: Clock = () => state.config.reconnectGraceMs + 1;
    const takeover = expireGrace(state, 2, expired, seed);
    state = takeover.state;
    expect(takeover.effects.some((e) => e.kind === 'botTakeoverRequested')).toBe(true);
    expect(state.seats.find((s) => s.seatIndex === 2)!.connectionStatus).toBe('BotControlled');

    const result = selfPlay(state, seed, PARTNERS_SHORT, makeRng(0xbeef));

    // The table finished after the human dropped, and the bot drove the taken-over seat.
    expect(result.state.lifecycle).toBe('Complete');
    expect(result.sawPersist).toBe(true);
    expect(result.botTurns.get(2) ?? 0).toBeGreaterThan(0);
    // No cold-start bot was ever seated — only the taken-over human seat is bot-driven.
    expect(result.state.seats.every((s) => !s.isBot)).toBe(true);
  });

  it('a returning human reclaims the seat and bot driving stops', () => {
    const seed = fixedSeeder();
    const dealt = bootDealtHumans(seed);
    // Drop the seat currently on the clock so it is unambiguously bot-driven after grace.
    const actor = dealt.engine!.public.seatToAct!;
    const token = dealt.seats.find((s) => s.seatIndex === actor)!.token;

    const dropped = leaveRoom(dealt, `conn-${actor}`, clock).state;
    const expired: Clock = () => dropped.config.reconnectGraceMs + 1;
    const bot = expireGrace(dropped, actor, expired, seed).state;
    // The taken-over seat, being the one on the clock, is now driven by the bot.
    expect(botSeatToDrive(bot)).toBe(actor);

    // The original human returns within the match and reclaims the seat.
    const back = reconnect(bot, token, `conn-${actor}-new`, clock);
    const restored = back.state;
    expect(restored.seats.find((s) => s.seatIndex === actor)!.connectionStatus).toBe('Connected');
    // Bot driving stops for the reclaimed seat; the human resumes control…
    expect(botSeatToDrive(restored)).toBeNull();
    // …and the reconnect pushed a full authoritative resync (view + clock state).
    expect(back.effects.some((e) => e.kind === 'view')).toBe(true);
    expect(back.effects.some((e) => e.kind === 'clockState')).toBe(true);
    // The connection id followed the reclaim; the bot never owned a synthetic conn here.
    expect(restored.seats.find((s) => s.seatIndex === actor)!.connectionId).toBe(`conn-${actor}-new`);
    expect(restored.seats.every((s) => s.connectionId !== botConnectionId(actor))).toBe(true);
  });
});
