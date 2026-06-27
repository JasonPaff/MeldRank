import { pgEnum } from 'drizzle-orm/pg-core';

/**
 * Shared Postgres enums for the match-record family (design D7). Closed,
 * slow-changing value sets become `pgEnum`s for DB-enforced integrity. The
 * vocabularies mirror what the room (the only writer) actually emits, not the
 * design doc's prose — widening a `pgEnum` later is an `ALTER TYPE` migration.
 */

/** Player discriminator: a Clerk-backed human or an engine bot. */
export const playerType = pgEnum('player_type', ['human', 'bot']);

/** Account lifecycle (supports anonymize-not-delete, Data Model §10). */
export const playerStatus = pgEnum('player_status', ['active', 'anonymized', 'banned']);

/** Match mode: rated ladder play or unrated casual. */
export const matchMode = pgEnum('match_mode', ['ranked', 'casual']);

/** Terminal match status. */
export const matchStatus = pgEnum('match_status', ['complete', 'aborted']);

/**
 * Why a match resolved. Mirrors the room's `ResolutionReason`
 * (`apps/match/src/room/types.ts`) — `forfeit_abandon` / `timeout_abandon` /
 * `aborted` — plus `played_out` for the not-yet-built played-out completion path.
 */
export const resolutionReason = pgEnum('resolution_reason', ['played_out', 'forfeit_abandon', 'timeout_abandon', 'aborted']);

/**
 * Canonical durable per-seat outcome. The engine's played-out path emits
 * `win`/`loss`; the writer normalizes the room's richer forfeit labels into this
 * set (`opponent_win → win`, `abandoner_loss`/`stranded_partner_reduced_loss →
 * loss`). `no_result` represents an aborted-match seat (nobody charged).
 */
export const participantOutcome = pgEnum('participant_outcome', ['win', 'loss', 'no_result']);

/** Kind of abandon event the leaver-penalty layer reads (Data Model §7). */
export const abandonKind = pgEnum('abandon_kind', ['forfeit_abandon', 'timeout_abandon']);
