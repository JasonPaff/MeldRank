import { initTRPC } from '@trpc/server';
import { createHTTPServer } from '@trpc/server/adapters/standalone';
import { healthy } from '@meldrank/shared';
import { createDb, createRedis, loadApiEnv } from '@meldrank/shared/server';

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

if (process.env.NODE_ENV !== 'test') {
  // Validate the environment once at boot (fail-fast), then construct the
  // foundation clients. No domain use yet — this only proves the wiring.
  const env = loadApiEnv();
  const db = createDb(env);
  const redis = createRedis(env);

  const port = env.PORT ?? 3001;
  const server = createHTTPServer({ router: appRouter });
  server.listen(port);
  console.log(
    `[api] tRPC stub listening on :${port} (db + redis clients ready: ${!!db && !!redis})`,
  );
}
