import { type DynamicRoute } from 'next-typesafe-url';
import { z } from 'zod';

/**
 * Typed contract for the `/table/[roomId]` route (next-typesafe-url). The
 * generator picks this up to produce `$path` route entries and the validators
 * the page's `useRouteParams` hook parses against. Only the `roomId` dynamic
 * segment is modelled — the table takes no search params; the seat ticket and
 * match handle still arrive via the in-memory session store (F1 handoff).
 */
export const Route = {
  routeParams: z.object({
    roomId: z.string(),
  }),
} satisfies DynamicRoute;

export type RouteType = typeof Route;
