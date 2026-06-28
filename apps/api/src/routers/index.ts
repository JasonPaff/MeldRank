import { healthy } from '@meldrank/shared';
import { createCallerFactory, publicProcedure, router } from '../trpc';
import { accountRouter } from './account';
import { casualRouter } from './casual';
import { matchRouter } from './match';
import { variantRouter } from './variant';

/**
 * The `apps/api` router tree (unit D): the minimal procedure set this slice ships —
 * `account`, `variant`, `casual`, `match` — plus a `health` liveness probe. Replaces
 * the former `health`-only stub root. The exported {@link AppRouter} type is the
 * client's end-to-end contract; {@link createCaller} builds an in-process caller for
 * tests and the integration seam.
 */
export const appRouter = router({
  health: publicProcedure.query(() => healthy('api')),
  account: accountRouter,
  variant: variantRouter,
  casual: casualRouter,
  match: matchRouter,
});

export type AppRouter = typeof appRouter;

/** Build an in-process caller bound to a given context (tests + integration). */
export const createCaller = createCallerFactory(appRouter);
