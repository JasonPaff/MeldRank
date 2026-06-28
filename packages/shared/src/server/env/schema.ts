import { z } from 'zod';

/**
 * Layered environment contract for the server processes. A `commonEnv` base is
 * shared by every process; per-process schemas extend it with the variables
 * that process actually needs. Each process validates exactly its own surface,
 * so a missing `CLERK_SECRET_KEY` fails `apps/api` but is irrelevant to
 * `apps/bots`.
 *
 * The public `NEXT_PUBLIC_*` contract for `apps/web` lives on the isomorphic
 * root entry (`../../env/web`), not here, because the browser bundle cannot
 * import the server-only surface.
 */
export const commonEnv = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

/** Neon Postgres connection string. */
const databaseShape = {
  DATABASE_URL: z.string().min(1),
} as const;

/** Upstash Redis REST credentials. */
const redisShape = {
  UPSTASH_REDIS_REST_URL: z.url(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1),
} as const;

/** Optional listen port for the long-lived services. */
const portShape = {
  PORT: z.coerce.number().int().positive().optional(),
} as const;

/**
 * The API↔Match seam secrets (capability `match-spawn-gateway`, design D1/D3),
 * shared by both processes: `INTERNAL_SPAWN_SECRET` gates the internal room-spawn
 * endpoint (the API presents it; the match service checks it, failing closed when
 * unset), and `SEAT_TICKET_SECRET` is the HMAC key the API mints seat tickets with
 * and the match room verifies at `onAuth`.
 */
const seamSecretsShape = {
  INTERNAL_SPAWN_SECRET: z.string().min(1),
  SEAT_TICKET_SECRET: z.string().min(1),
} as const;

/** `apps/api` — tRPC backend: database, Redis, Clerk secret, the spawn seam, listen port. */
export const apiEnv = z.object({
  ...commonEnv.shape,
  ...databaseShape,
  ...redisShape,
  ...portShape,
  ...seamSecretsShape,
  CLERK_SECRET_KEY: z.string().min(1),
  /** Base URL of the match service's internal spawn endpoint (the API calls it). */
  MATCH_INTERNAL_URL: z.url(),
});

/** `apps/match` — Colyseus service: database, Redis, the spawn seam, listen port. */
export const matchEnv = z.object({
  ...commonEnv.shape,
  ...databaseShape,
  ...redisShape,
  ...portShape,
  ...seamSecretsShape,
});

/** `apps/bots` — worker: database and Redis (no inbound listener). */
export const botsEnv = z.object({
  ...commonEnv.shape,
  ...databaseShape,
  ...redisShape,
});

export type CommonEnv = z.infer<typeof commonEnv>;
export type ApiEnv = z.infer<typeof apiEnv>;
export type MatchEnv = z.infer<typeof matchEnv>;
export type BotsEnv = z.infer<typeof botsEnv>;
