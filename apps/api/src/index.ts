import { createHTTPServer } from '@trpc/server/adapters/standalone';
import { createDb, createRedis, loadApiEnv } from '@meldrank/shared/server';
import { appRouter, type AppRouter } from './routers';
import { resolveStubIdentity } from './identity';
import { createCasualTableStore } from './lobby/store';
import { createTicketMinter } from './lobby/tickets';
import { createHttpSpawnClient } from './spawn/client';
import { variantCatalog } from './variants';
import type { ApiContext } from './trpc';

/**
 * The tRPC backend boot (unit D). Validates the environment (fail-fast), constructs the
 * foundation db/redis clients and the casual-lobby dependencies (the Redis-backed table
 * store, the seat-ticket minter, and the HTTP client to the match spawn gateway), and
 * serves the {@link appRouter} tree. Each request resolves the caller through the
 * centralized stub-identity seam (design D5). In `test` nothing is constructed — the
 * routers are exercised in-process via `createCaller` with injected fakes.
 */
export { appRouter, type AppRouter };

if (process.env.NODE_ENV !== 'test') {
  const env = loadApiEnv();
  const db = createDb(env);
  const redis = createRedis(env);

  const store = createCasualTableStore({ redis });
  const tickets = createTicketMinter({ secret: env.SEAT_TICKET_SECRET });
  const spawn = createHttpSpawnClient({ baseUrl: env.MATCH_INTERNAL_URL, secret: env.INTERNAL_SPAWN_SECRET });

  const port = env.PORT ?? 3001;
  const server = createHTTPServer({
    router: appRouter,
    createContext: ({ req }): ApiContext => {
      const { playerId } = resolveStubIdentity({ headers: req.headers });
      return { playerId, variants: variantCatalog, store, spawn, tickets };
    },
  });
  server.listen(port);
  console.log(`[api] tRPC listening on :${port} (db + redis clients ready: ${!!db && !!redis})`);
}
