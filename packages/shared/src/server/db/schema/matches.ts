import { boolean, index, integer, jsonb, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { matchMode, matchStatus, participantOutcome, resolutionReason } from './enums';
import { players } from './players';

/**
 * The match envelope (design D7, Data Model §4/§5). Every match is
 * self-describing: it always carries a `variant_snapshot` (jsonb) and a derived
 * `variant_hash`, plus a nullable `variant_id`/`variant_version` reference (set
 * for ranked, null for ad-hoc casual). The snapshot and hash are stored exactly
 * as the producer supplies them — this layer neither computes nor validates them.
 */
export const matches = pgTable(
  'matches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mode: matchMode('mode').notNull(),
    status: matchStatus('status').notNull(),
    resolutionReason: resolutionReason('resolution_reason').notNull(),
    variantId: text('variant_id'),
    variantVersion: integer('variant_version'),
    variantSnapshot: jsonb('variant_snapshot').notNull(),
    variantHash: text('variant_hash').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('matches_completed_at_idx').on(table.completedAt)],
);

/**
 * One row per seat in a match (design D7). `outcome` is the canonical durable
 * normalization of the room's labels (`win`/`loss`/`no_result`); `placement` is
 * a separate nullable rank so placement variants keep both a win/loss verdict and
 * the integer rank. `team` is the partnership id (null for free-for-all); the
 * abandoner is flagged by `is_abandoner`.
 */
export const matchParticipants = pgTable('match_participants', {
  id: uuid('id').primaryKey().defaultRandom(),
  matchId: uuid('match_id')
    .notNull()
    .references(() => matches.id),
  playerId: uuid('player_id')
    .notNull()
    .references(() => players.id),
  seatIndex: smallint('seat_index').notNull(),
  team: smallint('team'),
  outcome: participantOutcome('outcome').notNull(),
  placement: smallint('placement'),
  finalScore: integer('final_score').notNull(),
  isAbandoner: boolean('is_abandoner').notNull().default(false),
});
