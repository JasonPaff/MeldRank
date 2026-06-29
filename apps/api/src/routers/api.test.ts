import { describe, expect, it } from 'vitest';
import { CasualTableSchema, SINGLE_DECK_PARTNERS, type RoomSpawnRequest } from '@meldrank/shared';
import { createLogger } from '@meldrank/shared/server';
import { ApiError, type ApiContext } from '../trpc';
import { applyClaim, CLAIM_SCRIPT, createCasualTableStore, type LobbyRedis } from '../lobby/store';
import { createTicketMinter } from '../lobby/tickets';
import { variantCatalog } from '../variants';
import type { SpawnClient } from '../spawn/client';
import { createCaller } from './index';

/**
 * Router behavior with a faked Redis + spawn client (task 4.8): the seat-claim race
 * returns a single winner, a spawn failure rolls the table back, a seat ticket is
 * minted only on a spawned room, and `getActive` is populated only for a seated caller
 * in a live match. Exercised in-process through `createCaller` over an injected context.
 */

/** An in-memory {@link LobbyRedis} whose `eval` runs the same claim logic as the Lua script. */
class FakeRedis implements LobbyRedis {
  private readonly map = new Map<string, string>();
  private readonly sets = new Map<string, Set<string>>();

  get(key: string): Promise<unknown> {
    const raw = this.map.get(key);
    return Promise.resolve(raw === undefined ? null : JSON.parse(raw));
  }

  set(key: string, value: unknown): Promise<unknown> {
    this.map.set(key, JSON.stringify(value));
    return Promise.resolve('OK');
  }

  del(...keys: string[]): Promise<number> {
    let removed = 0;
    for (const key of keys) {
      if (this.map.delete(key)) removed++;
    }
    return Promise.resolve(removed);
  }

  sadd(key: string, ...members: string[]): Promise<number> {
    const set = this.sets.get(key) ?? new Set<string>();
    members.forEach((member) => set.add(member));
    this.sets.set(key, set);
    return Promise.resolve(members.length);
  }

  srem(key: string, ...members: string[]): Promise<number> {
    const set = this.sets.get(key);
    if (!set) return Promise.resolve(0);
    let removed = 0;
    members.forEach((member) => {
      if (set.delete(member)) removed++;
    });
    return Promise.resolve(removed);
  }

  smembers(key: string): Promise<string[]> {
    return Promise.resolve([...(this.sets.get(key) ?? [])]);
  }

  eval(script: string, keys: string[], args: (string | number)[]): Promise<unknown> {
    if (script !== CLAIM_SCRIPT) throw new Error(`unexpected script: ${script}`);
    const raw = this.map.get(keys[0]!);
    if (raw === undefined) return Promise.resolve('NOT_FOUND');
    const table = CasualTableSchema.parse(JSON.parse(raw));
    const result = applyClaim(table, Number(args[0]), JSON.parse(String(args[1])) as never);
    if (result === 'not-found') return Promise.resolve('NOT_FOUND');
    if (result === 'conflict') return Promise.resolve('CONFLICT');
    this.map.set(keys[0]!, JSON.stringify(result));
    return Promise.resolve(JSON.stringify(result));
  }
}

/** A controllable fake spawn client recording its requests. */
interface FakeSpawn extends SpawnClient {
  fail: boolean;
  roomId: string;
  readonly requests: RoomSpawnRequest[];
}

function fakeSpawn(): FakeSpawn {
  const spawn: FakeSpawn = {
    fail: false,
    roomId: 'room-1',
    requests: [],
    spawn(request) {
      spawn.requests.push(request);
      if (spawn.fail) return Promise.reject(new Error('spawn failed'));
      return Promise.resolve({ roomId: spawn.roomId });
    },
  };
  return spawn;
}

/** A shared test harness: one Redis/store/spawn, with per-player callers. */
function harness() {
  const redis = new FakeRedis();
  let ids = 0;
  let clock = 1_000;
  const store = createCasualTableStore({ redis, newId: () => `t${++ids}`, now: () => clock++ });
  const tickets = createTicketMinter({ secret: 'seat-secret', now: () => 5_000, ttlMs: 60_000 });
  const spawn = fakeSpawn();
  // A silenced logger keeps the procedure-failure middleware quiet under test.
  const log = createLogger('api');
  log.level = 'silent';
  const deps: Omit<ApiContext, 'playerId'> = { variants: variantCatalog, store, spawn, tickets, log, traceId: 'test-trace' };
  return {
    store,
    spawn,
    caller: (playerId: string) => createCaller({ ...deps, playerId }),
  };
}

const PARTNERS = SINGLE_DECK_PARTNERS.id;

describe('account + variant reference procedures', () => {
  it('getMe returns the resolved stub identity', async () => {
    const me = await harness().caller('p1').account.getMe();
    expect(me).toEqual({ playerId: 'p1', onboardingComplete: true });
  });

  it('variant.list returns the canonical variants and get resolves by id', async () => {
    const caller = harness().caller('p1');
    const list = await caller.variant.list();
    expect(list.map((v) => v.id)).toContain(PARTNERS);
    const got = await caller.variant.get({ id: PARTNERS });
    expect(got.id).toBe(PARTNERS);
  });

  it('variant.get rejects an unknown id with a typed not-found', async () => {
    await expect(harness().caller('p1').variant.get({ id: 'nope' })).rejects.toMatchObject({
      apiErrorCode: 'not-found',
    });
  });
});

describe('casual.createTable', () => {
  it('seats the creator, opens the table, and lists it', async () => {
    const h = harness();
    const table = await h.caller('p1').casual.createTable({ variantId: PARTNERS });
    expect(table.status).toBe('open');
    expect(table.seats[0]).toEqual({ kind: 'human', playerId: 'p1' });
    expect(table.seats.slice(1)).toEqual([{ kind: 'empty' }, { kind: 'empty' }, { kind: 'empty' }]);

    const open = await h.caller('p2').casual.listOpenTables({ limit: 20 });
    expect(open.items.map((t) => t.id)).toContain(table.id);
    expect(open.nextCursor).toBeNull();
  });

  it('rejects an unknown variant with a typed not-found', async () => {
    await expect(harness().caller('p1').casual.createTable({ variantId: 'nope' })).rejects.toBeInstanceOf(ApiError);
  });
});

describe('seat-claim race (atomic)', () => {
  it('returns exactly one winner; the loser gets a typed conflict', async () => {
    const h = harness();
    const table = await h.caller('p1').casual.createTable({ variantId: PARTNERS });

    const results = await Promise.allSettled([
      h.caller('p2').casual.joinSeat({ tableId: table.id, seat: 1 }),
      h.caller('p3').casual.joinSeat({ tableId: table.id, seat: 1 }),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ apiErrorCode: 'conflict' });

    // The seat's single occupant is whichever joiner won — never overwritten.
    const after = await h.store.get(table.id);
    expect(after?.seats[1]?.kind).toBe('human');
  });

  it('joining an occupied seat is rejected with conflict', async () => {
    const h = harness();
    const table = await h.caller('p1').casual.createTable({ variantId: PARTNERS });
    await h.caller('p2').casual.joinSeat({ tableId: table.id, seat: 1 });
    await expect(h.caller('p3').casual.joinSeat({ tableId: table.id, seat: 1 })).rejects.toMatchObject({
      apiErrorCode: 'conflict',
    });
  });

  it('joining a non-existent table is rejected with not-found', async () => {
    await expect(harness().caller('p1').casual.joinSeat({ tableId: 'ghost', seat: 1 })).rejects.toMatchObject({
      apiErrorCode: 'not-found',
    });
  });
});

describe('full-table spawn flow', () => {
  it('mints a ticket only when the room spawns', async () => {
    const h = harness();
    const table = await h.caller('p1').casual.createTable({ variantId: PARTNERS });

    // A non-filling join spawns nothing → no ticket.
    const join = await h.caller('p2').casual.joinSeat({ tableId: table.id, seat: 1 });
    expect(join.ticket).toBeNull();
    expect(h.spawn.requests).toHaveLength(0);

    // quickPlay fills + spawns → the caller's ticket is returned and bound to the room.
    const quick = await h.caller('p9').casual.quickPlay();
    expect(quick.ticket.payload).toMatchObject({ roomId: 'room-1', seat: 0, playerId: 'p9' });
    expect(quick.table.status).toBe('live');
    expect(quick.table.roomId).toBe('room-1');
  });

  it('rolls the table back to open and surfaces an error when spawn fails', async () => {
    const h = harness();
    h.spawn.fail = true;
    const table = await h.caller('p1').casual.createTable({ variantId: PARTNERS });
    await h.caller('p1').casual.addBot({ tableId: table.id, seat: 1 });
    await h.caller('p1').casual.addBot({ tableId: table.id, seat: 2 });

    // Filling the last seat triggers the spawn, which fails.
    await expect(h.caller('p1').casual.addBot({ tableId: table.id, seat: 3 })).rejects.toThrow();
    expect(h.spawn.requests).toHaveLength(1);

    const after = await h.store.get(table.id);
    expect(after?.status).toBe('open');
    expect(after?.roomId).toBeNull();
  });

  it('the spawn request carries the frozen variant, seating, and bot count', async () => {
    const h = harness();
    await h.caller('p9').casual.quickPlay();
    const request = h.spawn.requests[0]!;
    expect(request.variantId).toBe(PARTNERS);
    expect(request.bots).toBe(3);
    expect(request.seating).toEqual([{ kind: 'human', playerId: 'p9' }, { kind: 'bot' }, { kind: 'bot' }, { kind: 'bot' }]);
  });
});

describe('match.getActive', () => {
  it('is empty for a caller in no live match', async () => {
    expect(await harness().caller('p1').match.getActive()).toBeNull();
  });

  it('returns the room handle + seat for a caller in a live match', async () => {
    const h = harness();
    await h.caller('p1').casual.quickPlay();
    expect(await h.caller('p1').match.getActive()).toEqual({ roomId: 'room-1', seat: 0, variantId: PARTNERS });
    // A different player is in no live match.
    expect(await h.caller('p2').match.getActive()).toBeNull();
  });
});

describe('leaveTable', () => {
  it('frees the caller seat', async () => {
    const h = harness();
    const table = await h.caller('p1').casual.createTable({ variantId: PARTNERS });
    await h.caller('p2').casual.joinSeat({ tableId: table.id, seat: 1 });
    const left = await h.caller('p2').casual.leaveTable({ tableId: table.id });
    expect(left.seats[1]).toEqual({ kind: 'empty' });
  });
});
