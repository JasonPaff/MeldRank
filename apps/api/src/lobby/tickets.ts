import type { SeatTicket, SignedSeatTicket } from '@meldrank/shared';
import { signSeatTicket } from '@meldrank/shared/server';

/**
 * The seat-ticket minter (design D3): on a confirmed seat in a spawned room, the API
 * mints a short-lived signed ticket the client presents at the room's `onAuth`. The
 * expiry is stamped here from an injectable clock so the routers stay deterministic in
 * tests; the HMAC signing uses the server-only helper from `@meldrank/shared/server`.
 */
export interface TicketMinter {
  /** Mint a signed ticket for `payload`, stamping `exp` from the configured TTL. */
  mint(payload: Omit<SeatTicket, 'exp'>): SignedSeatTicket;
}

/** Options for the ticket minter: the HMAC secret, the TTL, and an injectable clock. */
export interface TicketMinterOptions {
  readonly secret: string;
  /** Ticket lifetime in milliseconds (default 2 minutes — enough to connect, short for replay). */
  readonly ttlMs?: number;
  /** Injected for testing; defaults to `Date.now`. */
  readonly now?: () => number;
}

/** The default seat-ticket lifetime. */
export const DEFAULT_TICKET_TTL_MS = 120_000;

/** Construct a {@link TicketMinter} that signs tickets with the shared seat-ticket secret. */
export function createTicketMinter(options: TicketMinterOptions): TicketMinter {
  const ttlMs = options.ttlMs ?? DEFAULT_TICKET_TTL_MS;
  const now = options.now ?? Date.now;
  return {
    mint(base) {
      const payload: SeatTicket = { ...base, exp: now() + ttlMs };
      return { token: signSeatTicket(payload, options.secret), payload };
    },
  };
}
