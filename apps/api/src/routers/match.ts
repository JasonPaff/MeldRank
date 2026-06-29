import { MatchGetActiveInputSchema, MatchGetActiveOutputSchema } from '@meldrank/shared';
import { protectedProcedure, router } from '../trpc';

/**
 * Match procedures (capability `casual-lobby-api`). `getActive` returns the caller's
 * currently-live match (room handle + seat) so a client can rejoin, or `null` when the
 * caller is in no live match.
 */
export const matchRouter = router({
  getActive: protectedProcedure
    .input(MatchGetActiveInputSchema)
    .output(MatchGetActiveOutputSchema)
    .query(async ({ ctx }) => {
      const table = await ctx.store.getActive(ctx.playerId);
      if (table === null || table.roomId === null) {
        return null;
      }
      const seat = table.seats.findIndex((occupant) => occupant.kind === 'human' && occupant.playerId === ctx.playerId);
      if (seat < 0) {
        return null;
      }
      return { roomId: table.roomId, seat, variantId: table.variantId };
    }),
});
