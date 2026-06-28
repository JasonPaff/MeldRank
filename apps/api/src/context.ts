import { createDb, createRedis, type loadApiEnv } from '@meldrank/shared/server';
import { resolveStubIdentity, type StubIdentitySource } from './identity';
import { createCasualTableStore } from './lobby/store';
import { createTicketMinter } from './lobby/tickets';
import { createHttpSpawnClient } from './spawn/client';
import { variantCatalog } from './variants';
import type { ApiContext, ApiDeps } from './trpc';

/**
 * The single place the API's runtime is constructed, shared by both serving entries —
 * the standalone `.listen()` dev server ({@link file://./index.ts}) and the Vercel
 * serverless function (`api/index.ts`). Building the dependencies (db, redis, the
 * Redis-backed casual-table store, the seat-ticket minter, the HTTP spawn client) in
 * one factory keeps the two entries from drifting and gives the function a single
 * module-scope construction point reused across warm invocations.
 */

/** The validated API environment (the shape `loadApiEnv` returns). */
type ApiEnv = ReturnType<typeof loadApiEnv>;

/** The constructed runtime: the per-request {@link ApiDeps} plus the raw db/redis clients. */
export interface ApiRuntime {
  readonly deps: ApiDeps;
  readonly db: ReturnType<typeof createDb>;
  readonly redis: ReturnType<typeof createRedis>;
}

/**
 * Construct the API runtime from a validated environment: the db + redis clients and
 * the casual-lobby dependencies (table store, ticket minter, HTTP spawn client) plus
 * the static variant catalog. Both serving entries call this exactly once.
 */
export function createApiRuntime(env: ApiEnv): ApiRuntime {
  const db = createDb(env);
  const redis = createRedis(env);

  const store = createCasualTableStore({ redis });
  const tickets = createTicketMinter({ secret: env.SEAT_TICKET_SECRET });
  const spawn = createHttpSpawnClient({ baseUrl: env.MATCH_INTERNAL_URL, secret: env.INTERNAL_SPAWN_SECRET });

  return { deps: { variants: variantCatalog, store, spawn, tickets }, db, redis };
}

/**
 * Build the per-request {@link ApiContext}: resolve the caller through the centralized
 * stub-identity seam (design D5) and attach the constructed deps. Both entries route
 * every request through this, so unit E swaps only `resolveStubIdentity` for real
 * identity without touching either serving path.
 */
export function buildContext(deps: ApiDeps, source: StubIdentitySource): ApiContext {
  const { playerId } = resolveStubIdentity(source);
  return { ...deps, playerId };
}
