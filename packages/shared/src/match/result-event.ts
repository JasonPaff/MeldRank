import { z } from 'zod';

/**
 * The status-only match result event (design D6) — the API↔Match contract published
 * over Redis pub/sub when a match's durable write commits. It carries just enough
 * for the API (unit D) to react: the DB-generated match identity, the mode/status/
 * resolution, the nullable variant reference, and each seat's normalized outcome.
 *
 * The heavy record — the ordered intent log and the seed reveals — is deliberately
 * **not** here; it lives only in the durable `match_replays` blob
 * ({@link ReplayBlobV1}). The vocabularies mirror the durable `match_*` Postgres
 * enums so the wire payload and the stored row never drift.
 */

/** The single Redis channel every match result is published to (design D6). */
export const MATCH_RESULT_CHANNEL = 'match.result';

/** A seat's outcome, normalized to the durable `participant_outcome` vocabulary. */
export const MatchSeatOutcomeSchema = z.object({
  seat: z.number().int().nonnegative(),
  outcome: z.enum(['win', 'loss', 'no_result']),
});

/** The published result event (design D6). */
export const MatchResultEventSchema = z.object({
  /** The database-generated match id (the write must commit before this exists). */
  matchId: z.string(),
  mode: z.enum(['ranked', 'casual']),
  status: z.enum(['complete', 'aborted']),
  resolutionReason: z.enum(['played_out', 'forfeit_abandon', 'timeout_abandon', 'aborted']),
  variantId: z.string().nullable(),
  variantVersion: z.number().int().nullable(),
  outcomes: z.array(MatchSeatOutcomeSchema),
});

export type MatchSeatOutcome = z.infer<typeof MatchSeatOutcomeSchema>;
export type MatchResultEvent = z.infer<typeof MatchResultEventSchema>;
