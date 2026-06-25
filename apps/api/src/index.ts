import { initTRPC } from '@trpc/server';
import { createHTTPServer } from '@trpc/server/adapters/standalone';
import { healthy } from '@meldrank/shared';

const t = initTRPC.create();

/**
 * Stateless tRPC backend stub. Real routers (auth, lobby, profile, …) land in
 * later changes; for now a single `health` procedure proves the server wires up
 * and can import schemas from `@meldrank/shared`.
 */
export const appRouter = t.router({
  health: t.procedure.query(() => healthy('api')),
});

export type AppRouter = typeof appRouter;

const port = Number(process.env.PORT ?? 3001);
const server = createHTTPServer({ router: appRouter });

if (process.env.NODE_ENV !== 'test') {
  server.listen(port);
  console.log(`[api] tRPC stub listening on :${port}`);
}
