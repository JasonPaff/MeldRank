import { MatchGetActiveInputSchema, MatchGetActiveOutputSchema } from '@meldrank/shared';
import { protectedProcedure, router } from '../trpc';

/**
 * Match procedures (capability `casual-lobby-api`). `getActive` returns the caller's
 * currently-live match (room handle + seat) so a client can rejoin, or `null` when the
 * caller is in no live match. For a live match it also mints a **fresh** signed seat
 * ticket via the same {@link TicketMinter} used at spawn (design D1): minting is
 * stateless re-mintable HMAC, so this delivers a valid warm-`joinById` credential to
 * *any* seated human — not only the caller who filled the last seat — and the 120s TTL
 * is fresh at the moment the client transitions into the room.
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
      const ticket = ctx.tickets.mint({ roomId: table.roomId, seat, playerId: ctx.playerId, variantId: table.variantId });
      return { roomId: table.roomId, seat, variantId: table.variantId, ticket };
    }),
});
