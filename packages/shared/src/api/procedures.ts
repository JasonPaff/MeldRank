import { z } from 'zod';
import { VariantDefinitionSchema } from '../variant/schema';
import { CursorPaginationInputSchema, paginated } from './pagination';
import { BotDifficultySchema, CasualTableSchema } from './table';
import { SignedSeatTicketSchema } from './ticket';

/**
 * The binding wire contracts for the minimal tRPC procedure set this slice
 * introduces (API Surface & Contracts §procedures). Every procedure has an
 * importable Zod input and output schema here, so the API and the client compile
 * against the *same* definitions for end-to-end types. This module owns only the
 * wire shape; the behavior behind each procedure is owned by `apps/api`.
 *
 * Schemas are isomorphic (Zod + types only — no driver, no secret). No-argument
 * procedures still export an explicit `z.void()` input so the set is uniform.
 */

/* ── account ──────────────────────────────────────────────────────────────── */

/** The caller's resolved local player view (at minimum the stub id + onboarding). */
export const PlayerViewSchema = z.object({
  playerId: z.string().min(1),
  onboardingComplete: z.boolean(),
});

export type PlayerView = z.infer<typeof PlayerViewSchema>;

export const AccountGetMeInputSchema = z.void();
export const AccountGetMeOutputSchema = PlayerViewSchema;

/* ── variant ──────────────────────────────────────────────────────────────── */

/**
 * The public, read-only variant projection a casual table is created from and a
 * rules reference reads. The full resolved Variant Definition is already public,
 * non-secret data, so the projection is the definition itself this slice.
 */
export const VariantViewSchema = VariantDefinitionSchema;

export type VariantView = z.infer<typeof VariantViewSchema>;

export const VariantListInputSchema = z.void();
export const VariantListOutputSchema = z.array(VariantViewSchema);

export const VariantGetInputSchema = z.object({ id: z.string().min(1) });
export const VariantGetOutputSchema = VariantViewSchema;

/* ── casual lobby ─────────────────────────────────────────────────────────── */

/**
 * The result of a seat-mutating casual action (`joinSeat`, `addBot`): the updated
 * table plus the caller's seat `ticket` when that action filled the table and
 * spawned the room (otherwise `null`). A human seat never receives a ticket
 * without a spawned room.
 */
export const CasualActionResultSchema = z.object({
  table: CasualTableSchema,
  ticket: SignedSeatTicketSchema.nullable(),
});

export type CasualActionResult = z.infer<typeof CasualActionResultSchema>;

export const CasualCreateTableInputSchema = z.object({ variantId: z.string().min(1) });
export const CasualCreateTableOutputSchema = CasualTableSchema;

export const CasualListOpenTablesInputSchema = CursorPaginationInputSchema;
export const CasualListOpenTablesOutputSchema = paginated(CasualTableSchema);

export const CasualJoinSeatInputSchema = z.object({
  tableId: z.string().min(1),
  seat: z.number().int().nonnegative(),
});
export const CasualJoinSeatOutputSchema = CasualActionResultSchema;

export const CasualLeaveTableInputSchema = z.object({ tableId: z.string().min(1) });
export const CasualLeaveTableOutputSchema = CasualTableSchema;

export const CasualGetTableInputSchema = z.object({ tableId: z.string().min(1) });
export const CasualGetTableOutputSchema = CasualTableSchema;

export const CasualAddBotInputSchema = z.object({
  tableId: z.string().min(1),
  seat: z.number().int().nonnegative(),
  difficulty: BotDifficultySchema.optional(),
});
export const CasualAddBotOutputSchema = CasualActionResultSchema;

/** `quickPlay` always spawns, so the caller's ticket is guaranteed (non-null). */
export const CasualQuickPlayInputSchema = z.void();
export const CasualQuickPlayOutputSchema = z.object({
  table: CasualTableSchema,
  ticket: SignedSeatTicketSchema,
});

export type CasualQuickPlayOutput = z.infer<typeof CasualQuickPlayOutputSchema>;

/* ── match ────────────────────────────────────────────────────────────────── */

/**
 * The caller's currently-live, reconnectable match: its room handle, seat, and a
 * freshly minted signed seat `ticket` for a warm `joinById`. The ticket is
 * **optional** so the additive change does not break callers that tolerate its
 * absence (the F1 Rejoin); it is present whenever a live match is returned.
 */
export const ActiveMatchSchema = z.object({
  roomId: z.string().min(1),
  seat: z.number().int().nonnegative(),
  variantId: z.string().min(1),
  ticket: SignedSeatTicketSchema.optional(),
});

export type ActiveMatch = z.infer<typeof ActiveMatchSchema>;

export const MatchGetActiveInputSchema = z.void();
/** Empty (`null`) when the caller is in no live match. */
export const MatchGetActiveOutputSchema = ActiveMatchSchema.nullable();
