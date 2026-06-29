import { describe, expect, it } from 'vitest';
import { createPlayerResolver, type PlayerCacheRedis, type PlayerStore } from './players';
import type { ClerkIdentity } from './identity';

/**
 * The Redis-cached resolve-or-create (capability `auth-identity`; design D2/D3), exercised
 * over a fake {@link PlayerStore} (an in-memory map that emulates the partial-unique index,
 * so a conflicting create converges on the existing id) and a fake cache. These prove the
 * resolver's behavior — first-request create, existing-user lookup, cache short-circuit,
 * concurrent convergence, and the webhook's authoritative refresh — without a live DB.
 */

interface StoreRow {
  readonly id: string;
  displayName: string;
  avatar: string | null;
}

/** A {@link PlayerStore} whose `createOrGetId` is idempotent on conflict, like the real ON CONFLICT. */
function fakeStore() {
  const rows = new Map<string, StoreRow>();
  let seq = 0;
  const calls = { findId: 0, createOrGetId: 0, upsertId: 0 };
  const store: PlayerStore = {
    findId(clerkUserId) {
      calls.findId++;
      return Promise.resolve(rows.get(clerkUserId)?.id ?? null);
    },
    createOrGetId(identity) {
      calls.createOrGetId++;
      const existing = rows.get(identity.clerkUserId);
      if (existing) return Promise.resolve(existing.id); // conflict → existing id, display untouched
      const id = `player-${++seq}`;
      rows.set(identity.clerkUserId, { id, displayName: identity.displayName, avatar: identity.avatar ?? null });
      return Promise.resolve(id);
    },
    upsertId(identity) {
      calls.upsertId++;
      const existing = rows.get(identity.clerkUserId);
      const id = existing?.id ?? `player-${++seq}`;
      rows.set(identity.clerkUserId, { id, displayName: identity.displayName, avatar: identity.avatar ?? null });
      return Promise.resolve(id);
    },
  };
  return { store, rows, calls };
}

/** A minimal in-memory {@link PlayerCacheRedis}. */
function fakeCache() {
  const map = new Map<string, string>();
  const calls = { get: 0, set: 0 };
  const redis: PlayerCacheRedis = {
    get(key) {
      calls.get++;
      return Promise.resolve(map.get(key) ?? null);
    },
    set(key, value) {
      calls.set++;
      map.set(key, String(value));
      return Promise.resolve('OK');
    },
  };
  return { redis, map, calls };
}

const identity = (clerkUserId: string, displayName = 'Pat'): ClerkIdentity => ({ clerkUserId, displayName });

describe('player resolver (resolve-or-create + cache)', () => {
  it('lazily creates a row for a brand-new Clerk user and caches the mapping', async () => {
    const { store, rows, calls } = fakeStore();
    const cache = fakeCache();
    const resolver = createPlayerResolver({ store, redis: cache.redis });

    const id = await resolver.resolve(identity('clerk_new'));

    expect(id).toBe('player-1');
    expect(calls.createOrGetId).toBe(1);
    expect(rows.size).toBe(1);
    expect(cache.map.get('identity:player:clerk_new')).toBe('player-1');
  });

  it('resolves an existing user from the DB without creating a row', async () => {
    const { store, calls } = fakeStore();
    await store.createOrGetId(identity('clerk_existing')); // pre-existing row
    const resolver = createPlayerResolver({ store, redis: fakeCache().redis });

    const id = await resolver.resolve(identity('clerk_existing'));

    expect(id).toBe('player-1');
    expect(calls.findId).toBe(1); // the resolve() lookup
    expect(calls.createOrGetId).toBe(1); // only the setup call, not a second create
  });

  it('returns a cached mapping without touching the store', async () => {
    const { store, calls } = fakeStore();
    const cache = fakeCache();
    cache.map.set('identity:player:clerk_cached', 'player-99');
    const resolver = createPlayerResolver({ store, redis: cache.redis });

    const id = await resolver.resolve(identity('clerk_cached'));

    expect(id).toBe('player-99');
    expect(calls.findId).toBe(0);
    expect(calls.createOrGetId).toBe(0);
  });

  it('converges two concurrent first requests on a single row and id', async () => {
    const { store, rows } = fakeStore();
    const resolver = createPlayerResolver({ store, redis: fakeCache().redis });

    const [a, b] = await Promise.all([resolver.resolve(identity('clerk_race')), resolver.resolve(identity('clerk_race'))]);

    expect(a).toBe(b);
    expect(rows.size).toBe(1);
  });

  it('upsert refreshes the Clerk-derived display name and caches the id', async () => {
    const { store, rows } = fakeStore();
    const cache = fakeCache();
    const resolver = createPlayerResolver({ store, redis: cache.redis });

    await resolver.upsert(identity('clerk_sync', 'Old Name'));
    const id = await resolver.upsert(identity('clerk_sync', 'New Name'));

    expect(rows.get('clerk_sync')).toMatchObject({ id, displayName: 'New Name' });
    expect(cache.map.get('identity:player:clerk_sync')).toBe(id);
  });
});
