import { describe, expect, it } from 'vitest';
import type { Client } from 'colyseus';
import { SINGLE_DECK_PARTNERS, type SeatTicket, type SpawnSeat } from '@meldrank/shared';
import { signSeatTicket } from '@meldrank/shared/server';
import { MatchRoom } from './matchRoom';
import type { RoomCoreState } from '../room';

/**
 * Seat-ticket `onAuth` verification + seat binding (task 3.5, capability
 * `match-room-lifecycle`/`match-spawn-gateway`). `onAuth` is the room's only auth gate;
 * we pin that a valid ticket is accepted and resolves to its reserved seat, that a
 * tampered/expired/room-mismatched/secret-missing ticket is rejected (fail closed), and
 * that a join carrying a verified ticket binds the connection to exactly that seat.
 */

const SECRET = 'seat-ticket-secret';
const ROOM_ID = 'room-1';

/** A one-human (seat 0) + three-bot Partners seating assignment. */
const SEATING: SpawnSeat[] = [{ kind: 'human', playerId: 'p1' }, { kind: 'bot' }, { kind: 'bot' }, { kind: 'bot' }];

/** Reach the room's private surface for the focused assertions. */
interface RoomInternals {
  core: RoomCoreState;
  roomId: string;
  seatTicketSecret?: string;
  clients: Client[];
}

/**
 * A `MatchRoom` created with the given seat-ticket secret and a fixed roomId. The
 * secret is required (no default) so an explicit `undefined` exercises the
 * no-secret fail-closed path rather than silently falling back.
 */
function newRoom(secret: string | undefined): { room: MatchRoom; internals: RoomInternals } {
  const room = new MatchRoom();
  room.onCreate({ seating: SEATING, seatTicketSecret: secret });
  const internals = room as unknown as RoomInternals;
  internals.roomId = ROOM_ID;
  internals.clients = [];
  return { room, internals };
}

/** A minimal fake client carrying a session id and (post-auth) the resolved ticket. */
function fakeClient(sessionId: string, auth?: SeatTicket): Client {
  return { sessionId, auth } as unknown as Client;
}

/** A valid (unexpired, this-room) seat ticket for seat 0. */
function ticketFor(seat = 0, roomId = ROOM_ID): SeatTicket {
  return { roomId, seat, playerId: 'p1', variantId: SINGLE_DECK_PARTNERS.id, exp: Date.now() + 60_000 };
}

describe('MatchRoom.onAuth — seat-ticket verification', () => {
  it('accepts a valid ticket and resolves its reserved seat', () => {
    const { room } = newRoom(SECRET);
    const token = signSeatTicket(ticketFor(0), SECRET);
    const payload = room.onAuth(fakeClient('c0'), { ticket: token });
    expect(payload.seat).toBe(0);
    expect(payload.roomId).toBe(ROOM_ID);
  });

  it('rejects a tampered ticket', () => {
    const { room } = newRoom(SECRET);
    const token = signSeatTicket(ticketFor(0), SECRET);
    const [body, sig] = token.split('.');
    const tampered = `${body!.slice(0, -1)}${body!.endsWith('A') ? 'B' : 'A'}.${sig}`;
    expect(() => room.onAuth(fakeClient('c0'), { ticket: tampered })).toThrow();
  });

  it('rejects an expired ticket', () => {
    const { room } = newRoom(SECRET);
    const expired: SeatTicket = { ...ticketFor(0), exp: 0 };
    const token = signSeatTicket(expired, SECRET);
    expect(() => room.onAuth(fakeClient('c0'), { ticket: token })).toThrow();
  });

  it('rejects a ticket whose roomId does not match this room', () => {
    const { room } = newRoom(SECRET);
    const token = signSeatTicket(ticketFor(0, 'other-room'), SECRET);
    expect(() => room.onAuth(fakeClient('c0'), { ticket: token })).toThrow();
  });

  it('rejects a ticket signed with a different secret', () => {
    const { room } = newRoom(SECRET);
    const token = signSeatTicket(ticketFor(0), 'wrong-secret');
    expect(() => room.onAuth(fakeClient('c0'), { ticket: token })).toThrow();
  });

  it('rejects when no ticket is presented', () => {
    const { room } = newRoom(SECRET);
    expect(() => room.onAuth(fakeClient('c0'), {})).toThrow();
  });

  it('fails closed when the room has no seat-ticket secret', () => {
    const { room } = newRoom(undefined);
    const token = signSeatTicket(ticketFor(0), SECRET);
    expect(() => room.onAuth(fakeClient('c0'), { ticket: token })).toThrow();
  });
});

describe('MatchRoom.onJoin — binds the connection to the ticketed seat', () => {
  it('seats a ticketed human at exactly the reserved (human) seat', () => {
    const { room, internals } = newRoom(SECRET);
    // Seats 1–3 were bot-filled at creation; seat 0 is the open human seat.
    expect(internals.core.seats.filter((s) => s.isBot).map((s) => s.seatIndex)).toEqual([1, 2, 3]);

    const payload = ticketFor(0);
    room.onJoin(fakeClient('human-conn', payload));

    const seated = internals.core.seats.find((s) => s.connectionId === 'human-conn');
    expect(seated?.seatIndex).toBe(0);
    expect(seated?.isBot).toBe(false);
  });
});
