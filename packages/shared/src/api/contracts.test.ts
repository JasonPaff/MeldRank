import { describe, expect, it } from 'vitest';
import { SINGLE_DECK_PARTNERS } from '../variant/canonical';
import * as isomorphicRoot from '../index';
import { signSeatTicket, verifySeatTicket } from '../server/api/ticket';
import {
  CasualGetTableInputSchema,
  CasualGetTableOutputSchema,
  CasualTableSchema,
  CursorPaginationInputSchema,
  MatchGetActiveOutputSchema,
  RoomSpawnRequestSchema,
  RoomSpawnResponseSchema,
  SeatTicketSchema,
  paginated,
  type CasualTable,
  type RoomSpawnRequest,
  type SeatTicket,
} from './index';

/**
 * Contract round-trips + the seat-ticket sign/verify invariants (task 1.6,
 * capability `shared-api-contracts`). The schemas are the binding wire shape, so we
 * pin that a representative record of each round-trips, that a minted ticket
 * verifies only with the same secret/untampered/unexpired, and — the boundary
 * invariant — that the sign/verify helper is reachable only from the server surface,
 * never the isomorphic root.
 */

describe('contract schema round-trips', () => {
  it('round-trips a casual-table record', () => {
    const table: CasualTable = {
      id: 'table-1',
      variantId: SINGLE_DECK_PARTNERS.id,
      variant: SINGLE_DECK_PARTNERS,
      status: 'open',
      seats: [{ kind: 'human', playerId: 'p1' }, { kind: 'empty' }, { kind: 'bot', difficulty: 'medium' }, { kind: 'empty' }],
      roomId: null,
      createdAt: 1_000,
      version: 0,
    };
    expect(CasualTableSchema.parse(table)).toEqual(table);
  });

  it('round-trips the room-spawn request/response pair', () => {
    const request: RoomSpawnRequest = {
      variantId: SINGLE_DECK_PARTNERS.id,
      variant: SINGLE_DECK_PARTNERS,
      seating: [{ kind: 'human', playerId: 'p1' }, { kind: 'bot' }, { kind: 'bot' }, { kind: 'bot' }],
      bots: 3,
    };
    expect(RoomSpawnRequestSchema.parse(request)).toEqual(request);
    expect(RoomSpawnResponseSchema.parse({ roomId: 'room-9' })).toEqual({ roomId: 'room-9' });
  });

  it('applies the cursor-pagination envelope with a default limit and nullable nextCursor', () => {
    expect(CursorPaginationInputSchema.parse({})).toEqual({ limit: 20 });
    const page = paginated(CasualTableSchema).parse({ items: [], nextCursor: null });
    expect(page).toEqual({ items: [], nextCursor: null });
  });

  it('exposes the casual.getTable input/output schemas (tableId in, table record out)', () => {
    expect(CasualGetTableInputSchema.parse({ tableId: 'table-1' })).toEqual({ tableId: 'table-1' });
    expect(() => CasualGetTableInputSchema.parse({ tableId: '' })).toThrow();
    const table: CasualTable = {
      id: 'table-1',
      variantId: SINGLE_DECK_PARTNERS.id,
      variant: SINGLE_DECK_PARTNERS,
      status: 'live',
      seats: [{ kind: 'human', playerId: 'p1' }, { kind: 'bot', difficulty: 'medium' }],
      roomId: 'room-9',
      createdAt: 1_000,
      version: 3,
    };
    expect(CasualGetTableOutputSchema.parse(table)).toEqual(table);
  });

  it('carries an optional seat ticket on the match.getActive output', () => {
    const handle = { roomId: 'room-9', seat: 2, variantId: SINGLE_DECK_PARTNERS.id };
    // The ticket is optional: a live match without one (the F1 Rejoin shape) still parses.
    expect(MatchGetActiveOutputSchema.parse(handle)).toEqual(handle);
    // A null result (no live match) still parses.
    expect(MatchGetActiveOutputSchema.parse(null)).toBeNull();
    // With a ticket, the field round-trips intact.
    const ticket = {
      token: 'signed.token',
      payload: { roomId: 'room-9', seat: 2, playerId: 'p1', variantId: SINGLE_DECK_PARTNERS.id, exp: 10_000 },
    };
    expect(MatchGetActiveOutputSchema.parse({ ...handle, ticket })).toEqual({ ...handle, ticket });
  });
});

describe('seat-ticket sign/verify', () => {
  const secret = 'test-seat-secret';
  const payload: SeatTicket = { roomId: 'room-1', seat: 2, playerId: 'p1', variantId: SINGLE_DECK_PARTNERS.id, exp: 10_000 };

  it('round-trips a signed ticket with the same secret before expiry', () => {
    const token = signSeatTicket(payload, secret);
    expect(verifySeatTicket(token, secret, 9_999)).toEqual(payload);
  });

  it('rejects a ticket signed with a different secret', () => {
    const token = signSeatTicket(payload, secret);
    expect(verifySeatTicket(token, 'other-secret', 9_999)).toBeNull();
  });

  it('rejects a tampered payload (signature no longer matches)', () => {
    const token = signSeatTicket(payload, secret);
    const [body, sig] = token.split('.');
    // Flip the last character of the encoded body, keeping the original signature.
    const flipped = body!.slice(0, -1) + (body!.endsWith('A') ? 'B' : 'A');
    expect(verifySeatTicket(`${flipped}.${sig}`, secret, 9_999)).toBeNull();
  });

  it('rejects an expired ticket', () => {
    const token = signSeatTicket(payload, secret);
    expect(verifySeatTicket(token, secret, 10_000)).toBeNull();
    expect(verifySeatTicket(token, secret, 10_001)).toBeNull();
  });

  it('rejects a malformed token', () => {
    expect(verifySeatTicket('not-a-token', secret, 0)).toBeNull();
    expect(verifySeatTicket('', secret, 0)).toBeNull();
    expect(verifySeatTicket('onlybody.', secret, 0)).toBeNull();
  });
});

describe('boundary: the sign/verify helper is server-only', () => {
  it('exposes the seat-ticket payload schema on the isomorphic root', () => {
    expect(isomorphicRoot.SeatTicketSchema).toBe(SeatTicketSchema);
  });

  it('does not export the sign/verify helper from the isomorphic root', () => {
    const root = isomorphicRoot as Record<string, unknown>;
    expect(root.signSeatTicket).toBeUndefined();
    expect(root.verifySeatTicket).toBeUndefined();
  });
});
