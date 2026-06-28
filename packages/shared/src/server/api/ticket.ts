import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { SeatTicketSchema, type SeatTicket } from '../../api/ticket';

/**
 * The **server-only** seat-ticket sign/verify helper (Auth & Identity §6, design
 * D3). The API mints a ticket on a confirmed seat; the match room verifies it at
 * `onAuth`. Both sides share a secret (env `SEAT_TICKET_SECRET`); the signature is
 * an HMAC-SHA256 over the encoded payload via the isomorphic `@noble/hashes`, so
 * the helper carries no Node-crypto or driver dependency — yet it is exported only
 * from `@meldrank/shared/server`, never the isomorphic root, so the secret-bearing
 * code can never reach the browser bundle.
 *
 * Token format: `<base64url(JSON payload)>.<hex HMAC over that base64url body>`.
 * Signing over the already-encoded body (rather than re-canonicalizing on verify)
 * makes verification a byte-exact recompute-and-compare with no JSON-ordering risk.
 */

/** Encode bytes as URL-safe base64 without padding. */
function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

/** Decode a URL-safe base64 string back to bytes; returns `null` on malformed input. */
function fromBase64Url(value: string): Uint8Array | null {
  try {
    return new Uint8Array(Buffer.from(value, 'base64url'));
  } catch {
    return null;
  }
}

/** Hex HMAC-SHA256 of `message` under `secret`. */
function sign(secret: string, message: string): string {
  return bytesToHex(hmac(sha256, utf8ToBytes(secret), utf8ToBytes(message)));
}

/** Constant-time equality over two hex signatures of equal length. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Mint a signed seat ticket: encode the payload and append its HMAC signature. */
export function signSeatTicket(payload: SeatTicket, secret: string): string {
  const body = toBase64Url(utf8ToBytes(JSON.stringify(SeatTicketSchema.parse(payload))));
  return `${body}.${sign(secret, body)}`;
}

/**
 * Verify a signed seat ticket against the shared secret at time `now` (epoch ms).
 * Returns the validated payload on success, or `null` when the token is malformed,
 * the signature does not match (tampered payload or wrong secret), the payload
 * fails its schema, or the ticket has expired (`now >= exp`).
 */
export function verifySeatTicket(token: string, secret: string, now: number): SeatTicket | null {
  const dot = token.lastIndexOf('.');
  if (dot <= 0 || dot === token.length - 1) {
    return null;
  }
  const body = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!timingSafeEqual(signature, sign(secret, body))) {
    return null;
  }
  const decoded = fromBase64Url(body);
  if (decoded === null) {
    return null;
  }
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(decoded).toString('utf8'));
  } catch {
    return null;
  }
  const parsed = SeatTicketSchema.safeParse(json);
  if (!parsed.success || now >= parsed.data.exp) {
    return null;
  }
  return parsed.data;
}
