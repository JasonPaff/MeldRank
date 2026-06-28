import { z } from 'zod';

/**
 * The small, typed error taxonomy the API surfaces expected failures with
 * (API Surface & Contracts §error model). Procedures map an expected failure to
 * one of these codes rather than leaking an ad-hoc shape, so the client can react
 * by code, not by message.
 *
 * This slice only ever emits `validation`, `not-found`, and `conflict` — the codes
 * the walking skeleton genuinely hits. `unauthorized`, `forbidden`, and
 * `rate-limited` stay **reserved** in the taxonomy for the Clerk-identity and
 * rate-limiting slices (unit E +) so the vocabulary is stable before those land. A
 * spawn-gateway failure is a server fault, not a client-facing code — it surfaces
 * as a standard internal error.
 */
export const API_ERROR_CODES = ['unauthorized', 'forbidden', 'not-found', 'rate-limited', 'validation', 'conflict'] as const;

/** Zod enum over the {@link API_ERROR_CODES} taxonomy. */
export const ApiErrorCodeSchema = z.enum(API_ERROR_CODES);

/** A typed API error code drawn from the shared taxonomy. */
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];
