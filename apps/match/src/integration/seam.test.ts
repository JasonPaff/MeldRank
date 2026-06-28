import { describe, expect, it } from 'vitest';
import type { Client } from 'colyseus';
import { SINGLE_DECK_PARTNERS, type RoomSpawnRequest, type SeatTicket, type SpawnSeat, type VariantDefinition } from '@meldrank/shared';
import { signSeatTicket } from '@meldrank/shared/server';
import { LegalPlayValidator, viewFor } from '@meldrank/engine';
import { brain, type RandomSource } from '@meldrank/bots';
import { handleSpawnRequest, type CreateRoomFn, type SpawnGatewayDeps } from '../gateway/spawn';
import { MatchRoom } from '../colyseus/matchRoom';
import { submitContribution, submitIntent } from '../room';
import { botSeatToDrive, engineActingSeat } from '../room/seating';
import type { Clock, PlayerIntent, RoomCoreState, ServerSeedSource } from '../room';

/**
 * End-to-end seam integration (task 5.1). Drives the walking skeleton's full path
 * across the API↔Match boundary in-process: a `quickPlay`-shaped spawn request (1 stub
 * human + 3 bots) → the match service's **real** spawn gateway → `matchMaker.createRoom`
 * (here a real {@link MatchRoom}) → the API mints the human seat's ticket with the same
 * `signSeatTicket` helper the API's minter uses → that ticket passes the room's real
 * `onAuth` and binds the reserved seat → the match self-plays to `Complete` and emits
 * the `persist` effect (the existing persistence path).
 *
 * The API-side procedure wiring (`casual.quickPlay` building the request and
 * `match.getActive` reflecting `live`) is unit-tested in `apps/api`; this test proves the
 * cross-service contract the two apps share — the spawn schema, the seat-ticket signing,
 * and the room's auth gate — actually lines up when wired together.
 */

const SECRET = 'shared-seat-secret';

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

const clock: Clock = () => 0;

function makeRng(seed: number): RandomSource {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A deterministic legal move for the stub human seat. */
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

/** Drive a Live room core to a terminal lifecycle, routing bots through the brain. */
function selfPlay(start: RoomCoreState, seed: ServerSeedSource, variant: VariantDefinition, rng: RandomSource) {
  let state = start;
  let sawPersist = false;
  for (let guard = 0; guard < 20_000 && state.lifecycle === 'Live'; guard++) {
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
    const intent =
      botSeatToDrive(state) === actor
        ? brain(viewFor(state.engine!, actor), { seat: actor, variant, difficulty: 'medium', random: rng })
        : humanStub(state, actor, variant);
    const step = submitIntent(state, conn, intent, `g-${guard}`, seed, clock);
    if (step.effects.some((e) => e.kind === 'persist')) {
      sawPersist = true;
    }
    state = step.state;
  }
  return { state, sawPersist };
}

/** Reach a constructed room's private surface for the assertions. */
interface RoomInternals {
  core: RoomCoreState;
  roomId: string;
  clients: Client[];
}

/** A minimal fake client carrying a session id and (post-auth) the resolved ticket. */
function fakeClient(sessionId: string, auth?: SeatTicket): Client {
  return { sessionId, auth } as unknown as Client;
}

describe('API↔Match seam — quickPlay → gateway → ticket → onAuth → self-play → persist', () => {
  it('drives a 1-human + 3-bot match end to end across the seam', async () => {
    // The gateway's room-creator builds a real MatchRoom (the room-definition default
    // injects the seat-ticket secret, as the production boot does) and registers it.
    const rooms = new Map<string, MatchRoom>();
    let roomCounter = 0;
    const createRoom: CreateRoomFn = (_name, options) => {
      const room = new MatchRoom();
      room.onCreate({ ...options, seatTicketSecret: SECRET });
      const roomId = `room-${++roomCounter}`;
      const internals = room as unknown as RoomInternals;
      internals.roomId = roomId;
      internals.clients = [];
      rooms.set(roomId, room);
      return Promise.resolve({ roomId });
    };
    const deps: SpawnGatewayDeps = { secret: SECRET, createRoom };

    // The API assembles the quickPlay spawn request: caller at seat 0, three bots.
    const seating: SpawnSeat[] = [{ kind: 'human', playerId: 'p1' }, { kind: 'bot' }, { kind: 'bot' }, { kind: 'bot' }];
    const request: RoomSpawnRequest = { variantId: SINGLE_DECK_PARTNERS.id, variant: SINGLE_DECK_PARTNERS, seating, bots: 3 };

    // Spawn gateway: authenticated request → room handle.
    const spawnResult = await handleSpawnRequest(deps, SECRET, request);
    expect(spawnResult.status).toBe(200);
    const { roomId } = spawnResult.body as { roomId: string };

    // The API mints the human seat's ticket with the shared signing helper.
    const payload: SeatTicket = { roomId, seat: 0, playerId: 'p1', variantId: SINGLE_DECK_PARTNERS.id, exp: Date.now() + 60_000 };
    const token = signSeatTicket(payload, SECRET);

    // The room verifies the ticket at its real onAuth gate and binds the reserved seat.
    const room = rooms.get(roomId)!;
    const verified = room.onAuth(fakeClient('p1-conn'), { ticket: token });
    expect(verified.seat).toBe(0);
    expect(verified.roomId).toBe(roomId);

    room.onJoin(fakeClient('p1-conn', verified));
    const internals = room as unknown as RoomInternals;
    expect(internals.core.lifecycle).toBe('Live');
    const humanSeat = internals.core.seats.find((s) => s.connectionId === 'p1-conn');
    expect(humanSeat?.seatIndex).toBe(0);
    expect(humanSeat?.isBot).toBe(false);
    expect(internals.core.seats.filter((s) => s.isBot).map((s) => s.seatIndex)).toEqual([1, 2, 3]);

    // The room self-plays to completion and emits the durable record (persistence path).
    const result = selfPlay(internals.core, fixedSeeder(), SINGLE_DECK_PARTNERS, makeRng(0x5ea7));
    expect(result.state.lifecycle).toBe('Complete');
    expect(result.state.engine!.public.matchResult?.complete).toBe(true);
    expect(result.sawPersist).toBe(true);
  });

  it('rejects the spawn request when the internal secret is wrong (seam is gated)', async () => {
    const createRoom: CreateRoomFn = () => Promise.resolve({ roomId: 'should-not-happen' });
    const deps: SpawnGatewayDeps = { secret: SECRET, createRoom };
    const request: RoomSpawnRequest = {
      variantId: SINGLE_DECK_PARTNERS.id,
      variant: SINGLE_DECK_PARTNERS,
      seating: [{ kind: 'human', playerId: 'p1' }, { kind: 'bot' }, { kind: 'bot' }, { kind: 'bot' }],
      bots: 3,
    };
    const result = await handleSpawnRequest(deps, 'wrong-secret', request);
    expect(result.status).toBe(401);
  });
});
