import { type DynamicRoute } from 'next-typesafe-url';
import { z } from 'zod';

/**
 * Typed contract for the `/table/pending/[tableId]` waiting-room route
 * (next-typesafe-url). Keyed by the ephemeral `tableId` (pre-room), distinct from
 * the `roomId`-keyed `/table/[roomId]` play route (design D6). Only the `tableId`
 * dynamic segment is modelled — the waiting room takes no search params; the seat
 * ticket and match handle arrive via the in-memory session store on the live
 * handoff, exactly as the play route's F1 handoff.
 */
export const Route = {
  routeParams: z.object({
    tableId: z.string(),
  }),
} satisfies DynamicRoute;

export type RouteType = typeof Route;
