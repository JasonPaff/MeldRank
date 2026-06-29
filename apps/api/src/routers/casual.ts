import { TRPCError } from '@trpc/server';
import {
  CasualAddBotInputSchema,
  CasualAddBotOutputSchema,
  CasualCreateTableInputSchema,
  CasualCreateTableOutputSchema,
  CasualJoinSeatInputSchema,
  CasualJoinSeatOutputSchema,
  CasualLeaveTableInputSchema,
  CasualLeaveTableOutputSchema,
  CasualListOpenTablesInputSchema,
  CasualListOpenTablesOutputSchema,
  CasualQuickPlayInputSchema,
  CasualQuickPlayOutputSchema,
  DEFAULT_BOT_DIFFICULTY,
} from '@meldrank/shared';
import { apiError, publicProcedure, router } from '../trpc';
import { spawnIfFull } from '../lobby/spawn-flow';
import { DEFAULT_VARIANT_ID } from '../variants';

/**
 * The casual table lifecycle (capability `casual-lobby-api`) over ephemeral Redis
 * state: create / list / join / leave / add-bot / quick-play. Seat mutations are
 * race-safe (the store's atomic claim); a claim conflict surfaces as the typed
 * `conflict`, an unknown variant/table as `not-found`. Filling the final seat triggers
 * the shared {@link spawnIfFull} flow, which spawns the room and mints the caller's
 * seat ticket.
 */
export const casualRouter = router({
  createTable: publicProcedure
    .input(CasualCreateTableInputSchema)
    .output(CasualCreateTableOutputSchema)
    .mutation(async ({ ctx, input }) => {
      const variant = ctx.variants.get(input.variantId);
      if (variant === null) {
        throw apiError('not-found', `unknown variant: ${input.variantId}`);
      }
      return ctx.store.create(variant, ctx.playerId);
    }),

  listOpenTables: publicProcedure
    .input(CasualListOpenTablesInputSchema)
    .output(CasualListOpenTablesOutputSchema)
    .query(async ({ ctx, input }) => {
      const page = await ctx.store.listOpen(input);
      return { items: [...page.items], nextCursor: page.nextCursor };
    }),

  joinSeat: publicProcedure
    .input(CasualJoinSeatInputSchema)
    .output(CasualJoinSeatOutputSchema)
    .mutation(async ({ ctx, input }) => {
      const claim = await ctx.store.claimSeat(input.tableId, input.seat, { kind: 'human', playerId: ctx.playerId });
      if (!claim.ok) {
        throw apiError(claim.reason);
      }
      return spawnIfFull(ctx, claim.table, ctx.playerId, ctx.traceId);
    }),

  leaveTable: publicProcedure
    .input(CasualLeaveTableInputSchema)
    .output(CasualLeaveTableOutputSchema)
    .mutation(async ({ ctx, input }) => {
      const table = await ctx.store.releaseSeat(input.tableId, ctx.playerId);
      if (table === null) {
        throw apiError('not-found', `unknown table: ${input.tableId}`);
      }
      return table;
    }),

  addBot: publicProcedure
    .input(CasualAddBotInputSchema)
    .output(CasualAddBotOutputSchema)
    .mutation(async ({ ctx, input }) => {
      const difficulty = input.difficulty ?? DEFAULT_BOT_DIFFICULTY;
      const claim = await ctx.store.claimSeat(input.tableId, input.seat, { kind: 'bot', difficulty });
      if (!claim.ok) {
        throw apiError(claim.reason);
      }
      return spawnIfFull(ctx, claim.table, ctx.playerId, ctx.traceId);
    }),

  quickPlay: publicProcedure
    .input(CasualQuickPlayInputSchema)
    .output(CasualQuickPlayOutputSchema)
    .mutation(async ({ ctx }) => {
      const variant = ctx.variants.get(DEFAULT_VARIANT_ID);
      if (variant === null) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'default variant unavailable' });
      }
      // Create-only (resolved 2026-06-27): a fresh table, caller seated, the rest bot-filled.
      let table = await ctx.store.create(variant, ctx.playerId);
      for (let seat = 1; seat < table.seats.length; seat++) {
        const claim = await ctx.store.claimSeat(table.id, seat, { kind: 'bot', difficulty: DEFAULT_BOT_DIFFICULTY });
        if (!claim.ok) {
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'failed to bot-fill quick-play table' });
        }
        table = claim.table;
      }
      const result = await spawnIfFull(ctx, table, ctx.playerId, ctx.traceId);
      if (result.ticket === null) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'quick-play produced no seat ticket' });
      }
      return { table: result.table, ticket: result.ticket };
    }),
});
