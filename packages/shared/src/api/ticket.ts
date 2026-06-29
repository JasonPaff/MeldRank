import { z } from 'zod';

/**
 * The seat-ticket payload (Auth & Identity §6): the small, signed claim the API
 * mints on a confirmed seat and the match room verifies at `onAuth` to bind a
 * connection to its reserved seat. The payload is **isomorphic** (this file) — the
 * client carries it on the wire; the HMAC sign/verify helper that produces and
 * checks the signature is server-only and lives in `@meldrank/shared/server`.
 *
 * `playerId` is the seated player's internal `players.id` UUID — resolved from the
 * authenticated Clerk caller at the API identity edge (Auth & Identity; design D1). The
 * match room treats it as an opaque string, so the value changed but the ticket shape and
 * verification did not.
 */
export const SeatTicketSchema = z.object({
  /** The spawned room the ticket admits the holder to. */
  roomId: z.string().min(1),
  /** The seat index the holder is bound to (server-authoritative; the client cannot choose). */
  seat: z.number().int().nonnegative(),
  /** The seated player's internal `players.id` UUID (resolved from the Clerk caller). */
  playerId: z.string().min(1),
  /** The frozen variant the room runs, carried for the client's reference. */
  variantId: z.string().min(1),
  /** Expiry as epoch milliseconds; a ticket presented at/after this is rejected. */
  exp: z.number().int().nonnegative(),
});

export type SeatTicket = z.infer<typeof SeatTicketSchema>;

/**
 * A minted seat ticket as returned to the client: the opaque signed `token` the
 * client presents at the room's `onAuth` gate, plus the decoded `payload` for the
 * client's own use (which room/seat it admits to). The signature lives inside the
 * token; the payload is the human-readable mirror.
 */
export const SignedSeatTicketSchema = z.object({
  token: z.string().min(1),
  payload: SeatTicketSchema,
});

export type SignedSeatTicket = z.infer<typeof SignedSeatTicketSchema>;
