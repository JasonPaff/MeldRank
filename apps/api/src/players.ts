import { eq, sql } from 'drizzle-orm';
import { dbSchema, type DatabaseClient } from '@meldrank/shared/server';
import type { ClerkIdentity } from './identity';

const { players } = dbSchema;

/**
 * The DB half of identity resolution (design D6). It maps `clerk_user_id → players.id`
 * and creates the row when absent. The create is a single
 * `INSERT ... ON CONFLICT (clerk_user_id) DO UPDATE ... RETURNING id` statement, so two
 * racing first requests for the same Clerk user converge on one row and the same id (the
 * partial-unique index is the guard) — no interactive transaction, matching the Neon HTTP
 * driver constraint the persistence writer already works around.
 */
export interface PlayerStore {
  /** The stored `players.id` for a Clerk user, or `null` if no row exists yet. */
  findId(clerkUserId: string): Promise<string | null>;
  /**
   * Lazy resolve-or-create: insert the `human` row or, on conflict, return the existing
   * id leaving the display fields untouched (the webhook owns those — design D2).
   */
  createOrGetId(identity: ClerkIdentity): Promise<string>;
  /** Authoritative upsert (webhook): refresh the Clerk-derived `display_name`/`avatar`, returning the id. */
  upsertId(identity: ClerkIdentity): Promise<string>;
}

/** Drizzle-backed {@link PlayerStore} over the Neon HTTP client. */
export function createPlayerStore(db: DatabaseClient): PlayerStore {
  // ON CONFLICT must match the partial-unique index, so it carries the same predicate.
  const onClerkConflict = { target: players.clerkUserId, targetWhere: sql`${players.clerkUserId} is not null` } as const;
  return {
    async findId(clerkUserId) {
      const rows = await db.select({ id: players.id }).from(players).where(eq(players.clerkUserId, clerkUserId)).limit(1);
      return rows[0]?.id ?? null;
    },
    async createOrGetId(identity) {
      const rows = await db
        .insert(players)
        .values({ type: 'human', clerkUserId: identity.clerkUserId, displayName: identity.displayName })
        // No-op touch on conflict so the statement still `RETURNING`s the existing id without
        // clobbering the webhook-owned display fields.
        .onConflictDoUpdate({ ...onClerkConflict, set: { updatedAt: sql`now()` } })
        .returning({ id: players.id });
      return rows[0]!.id;
    },
    async upsertId(identity) {
      const rows = await db
        .insert(players)
        .values({
          type: 'human',
          clerkUserId: identity.clerkUserId,
          displayName: identity.displayName,
          avatar: identity.avatar ?? null,
        })
        .onConflictDoUpdate({
          ...onClerkConflict,
          set: { displayName: identity.displayName, avatar: identity.avatar ?? null, updatedAt: sql`now()` },
        })
        .returning({ id: players.id });
      return rows[0]!.id;
    },
  };
}

/** Minimal Redis surface the resolver caches through; satisfied by the Upstash client and the test fake. */
export interface PlayerCacheRedis {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown, opts?: { ex?: number }): Promise<unknown>;
}

/**
 * Resolves a Clerk identity to the internal `players.id`, Redis-cached (design D3). The
 * mapping is immutable for a user's lifetime, so a hit returns the UUID with no DB read
 * and the cache needs no steady-state invalidation (a long TTL is a cold-cache bound, not
 * correctness). A miss falls through to the store's resolve-or-create and writes back.
 */
export interface PlayerResolver {
  /** Hot path: cache → DB lookup → resolve-or-create. */
  resolve(identity: ClerkIdentity): Promise<string>;
  /** Webhook path: authoritative upsert (refreshes display fields) + cache write-back. */
  upsert(identity: ClerkIdentity): Promise<string>;
}

const cacheKey = (clerkUserId: string): string => `identity:player:${clerkUserId}`;
/** 30 days; the mapping is immutable, so the TTL is only a cold-cache bound, never correctness. */
const CACHE_TTL_SECONDS = 60 * 60 * 24 * 30;

export function createPlayerResolver(opts: { store: PlayerStore; redis: PlayerCacheRedis }): PlayerResolver {
  const { store, redis } = opts;

  async function cacheWrite(clerkUserId: string, playerId: string): Promise<void> {
    await redis.set(cacheKey(clerkUserId), playerId, { ex: CACHE_TTL_SECONDS });
  }

  return {
    async resolve(identity) {
      const cached = await redis.get(cacheKey(identity.clerkUserId));
      if (typeof cached === 'string' && cached !== '') return cached;

      const existing = await store.findId(identity.clerkUserId);
      const id = existing ?? (await store.createOrGetId(identity));
      await cacheWrite(identity.clerkUserId, id);
      return id;
    },
    async upsert(identity) {
      const id = await store.upsertId(identity);
      await cacheWrite(identity.clerkUserId, id);
      return id;
    },
  };
}
