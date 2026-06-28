import { z } from 'zod';
import { VariantDefinitionSchema } from '../variant/schema';

/**
 * The ephemeral casual-table state shapes (Lobby & Matchmaking §casual tables,
 * design D2): a casual table is a small JSON record held in Redis (no Postgres
 * row), carrying its frozen variant, per-seat occupancy, and lifecycle status.
 * The API reads and writes a single validated shape so a malformed record fails
 * loudly at the boundary rather than downstream.
 */

/**
 * Requested bot strength (Lobby & Matchmaking §bots). Accepted in the contract to
 * future-proof the wire; this slice always seats the random-legal brain regardless
 * of difficulty (the tiers grow later with no contract change).
 */
export const BotDifficultySchema = z.enum(['easy', 'medium', 'hard']);

export type BotDifficulty = z.infer<typeof BotDifficultySchema>;

/** The default bot difficulty when a caller does not specify one. */
export const DEFAULT_BOT_DIFFICULTY: BotDifficulty = 'medium';

/**
 * A single seat's occupancy: empty, a human (a stub `playerId` this slice), or a
 * bot fill (carrying the requested, behaviorally-ignored difficulty).
 */
export const TableSeatSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('empty') }),
  z.object({ kind: z.literal('human'), playerId: z.string().min(1) }),
  z.object({ kind: z.literal('bot'), difficulty: BotDifficultySchema }),
]);

export type TableSeat = z.infer<typeof TableSeatSchema>;

/**
 * The casual-table lifecycle (design D2): `open` accepts seat/bot joins and is
 * listable; `spawning` is the in-flight room request (no longer joinable, not yet
 * playable); `live` is the spawned, playable room. A failed spawn rolls `spawning`
 * back to `open`.
 */
export const TableStatusSchema = z.enum(['open', 'spawning', 'live']);

export type TableStatus = z.infer<typeof TableStatusSchema>;

/**
 * The full ephemeral casual-table record. `variant` is the frozen snapshot the
 * room is spawned with; `roomId` is null until the table reaches `live`. `version`
 * is the optimistic-concurrency counter the store bumps on every mutation so a
 * race-safe seat claim can detect a lost update; `createdAt` (epoch ms) orders the
 * open-table listing.
 */
export const CasualTableSchema = z.object({
  id: z.string().min(1),
  variantId: z.string().min(1),
  variant: VariantDefinitionSchema,
  status: TableStatusSchema,
  seats: z.array(TableSeatSchema).min(1),
  roomId: z.string().nullable(),
  createdAt: z.number().int().nonnegative(),
  version: z.number().int().nonnegative(),
});

export type CasualTable = z.infer<typeof CasualTableSchema>;
