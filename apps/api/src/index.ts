import { createHTTPServer } from '@trpc/server/adapters/standalone';
import { loadApiEnv } from '@meldrank/shared/server';
import { appRouter, type AppRouter } from './routers';
import { buildContext, createApiRuntime } from './context';
import { corsHeaders, CORS_PREFLIGHT_STATUS } from './cors';

/**
 * The tRPC backend's **standalone HTTP entry** (unit D). It validates the environment
 * (fail-fast), constructs the runtime via the shared {@link createApiRuntime} factory, and
 * serves the {@link appRouter} over a long-lived `.listen()` HTTP server with the shared
 * single-origin CORS policy. Each request resolves the caller through the centralized
 * stub-identity seam (design D5) via {@link buildContext}.
 *
 * This long-lived server is both the local-dev entry (`pnpm --filter @meldrank/api dev`)
 * and the deployed surface: the API now runs on Fly.io, where the Dockerfile launches this
 * same entry via the `start` script (`tsx src/index.ts`). In `test` nothing is constructed
 * — the routers are exercised in-process via `createCaller` with injected fakes.
 */
export { appRouter, type AppRouter };

if (process.env.NODE_ENV !== 'test') {
  const env = loadApiEnv();
  const { deps, db, redis } = createApiRuntime(env);
  const log = deps.log;
  const headers = corsHeaders(env.WEB_APP_ORIGIN);

  const port = env.PORT ?? 3001;
  const server = createHTTPServer({
    router: appRouter,
    /**
     * CORS for the single configured web origin (shared {@link corsHeaders}). Reflects
     * `WEB_APP_ORIGIN`, allows the tRPC methods/headers, and short-circuits the `OPTIONS`
     * preflight before the tRPC handler runs.
     */
    middleware: (req, res, next) => {
      for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
      if (req.method === 'OPTIONS') {
        res.writeHead(CORS_PREFLIGHT_STATUS);
        res.end();
        return;
      }
      next();
    },
    createContext: ({ req }) => buildContext(deps, { headers: req.headers }),
  });
  server.listen(port);
  log.info({ port, db: !!db, redis: !!redis }, 'tRPC listening');
}
