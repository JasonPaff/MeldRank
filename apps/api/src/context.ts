import { randomUUID } from 'node:crypto';
import { createDb, createLogger, createRedis, TRACE_ID_HEADER, type loadApiEnv } from '@meldrank/shared/server';
import { createClerkAuth } from './identity';
import { createCasualTableStore } from './lobby/store';
import { createTicketMinter } from './lobby/tickets';
import { createPlayerResolver, createPlayerStore } from './players';
import { createHttpSpawnClient } from './spawn/client';
import { variantCatalog } from './variants';
import type { ApiContext, ApiDeps } from './trpc';

/** The minimal request shape context-building reads — just its headers. */
export interface RequestSource {
  readonly headers?: Record<string, string | string[] | undefined>;
}

/**
 * The single place the API's runtime is constructed, used by the standalone `.listen()`
 * serving entry ({@link file://./index.ts}) — the local-dev server and the deployed Fly
 * surface. Building the dependencies (db, redis, the Redis-backed casual-table store, the
 * seat-ticket minter, the HTTP spawn client, the Clerk auth verifier and player resolver)
 * in one factory keeps construction in a single reusable place.
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
  const log = createLogger('api', { level: env.LOG_LEVEL, pretty: env.NODE_ENV !== 'production' });
  const db = createDb(env);
  const redis = createRedis(env);

  const store = createCasualTableStore({ redis });
  const tickets = createTicketMinter({ secret: env.SEAT_TICKET_SECRET });
  const spawn = createHttpSpawnClient({ baseUrl: env.MATCH_INTERNAL_URL, secret: env.INTERNAL_SPAWN_SECRET });
  // The identity edge (design D5/D6): verify Clerk Bearer sessions against the secret key
  // (the web origin is the authorized party), and resolve them to internal `players.id`s
  // through the Redis-cached resolve-or-create over the db.
  const auth = createClerkAuth({ secretKey: env.CLERK_SECRET_KEY, authorizedParties: [env.WEB_APP_ORIGIN] });
  const players = createPlayerResolver({ store: createPlayerStore(db), redis });

  return { deps: { variants: variantCatalog, store, spawn, tickets, auth, players, log }, db, redis };
}

/**
 * Build the per-request {@link ApiContext}: authenticate the caller at the centralized
 * identity seam (design D5) and attach the constructed deps. The Bearer session token is
 * verified and resolved to an internal `players.id` (`null` when unauthenticated;
 * {@link protectedProcedure} rejects those). Both entries route every request through
 * this, so neither serving path re-reads identity.
 */
export async function buildContext(deps: ApiDeps, source: RequestSource): Promise<ApiContext> {
  const playerId = await resolvePlayerId(deps, source);
  // Originate the request's trace id (design D4): inherit an inbound
  // `x-meldrank-trace-id` (forward-compatible with a future web origin), else generate
  // one. Bind it to the request logger so every procedure line — and the failure log —
  // shares this id, and carry it onto the internal spawn hop.
  const inbound = source.headers?.[TRACE_ID_HEADER];
  const headerTrace = (Array.isArray(inbound) ? inbound[0] : inbound)?.trim();
  const traceId = headerTrace !== undefined && headerTrace !== '' ? headerTrace : randomUUID();
  return { ...deps, playerId, traceId, log: deps.log.child({ traceId }) };
}

/**
 * Resolve the caller's internal `players.id` from the `Authorization: Bearer` header, or
 * `null` when the request is unauthenticated (no/invalid token). Verification and the
 * resolve-or-create both live in injected deps so the seam stays testable in isolation.
 */
async function resolvePlayerId(deps: ApiDeps, source: RequestSource): Promise<string | null> {
  const raw = source.headers?.authorization;
  const authorization = Array.isArray(raw) ? raw[0] : raw;
  const identity = await deps.auth.verifyBearer(authorization);
  if (identity === null) return null;
  return deps.players.resolve(identity);
}
