import { randomUUID } from 'node:crypto';
import {
  CasualTableSchema,
  type CasualTable,
  type CursorPaginationInput,
  type Paginated,
  type TableSeat,
  type VariantView,
} from '@meldrank/shared';

/**
 * The ephemeral casual-table store (design D2; capability `casual-lobby-api`). Tables
 * live only in Redis (no Postgres row) with a TTL, so the skeleton lobby is naturally
 * disposable. The one integrity-critical operation — claiming a seat — is **atomic**:
 * it runs a single read-check-write Lua script ({@link CLAIM_SCRIPT}) on Redis so two
 * concurrent joiners can never both take the same seat, nor silently clobber each
 * other's distinct seats with a lost read-modify-write. Every other transition is
 * driven by the single caller who atomically filled the last seat, so a plain
 * read-modify-write is sufficient there.
 */

/** The minimal Redis surface the store uses; satisfied by the Upstash client and the test fake. */
export interface LobbyRedis {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown, opts?: { ex?: number }): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  sadd(key: string, ...members: string[]): Promise<number>;
  srem(key: string, ...members: string[]): Promise<number>;
  smembers(key: string): Promise<string[]>;
  eval(script: string, keys: string[], args: (string | number)[]): Promise<unknown>;
}

/** The outcome of an atomic seat/bot claim. */
export type ClaimOutcome =
  | { readonly ok: true; readonly table: CasualTable }
  | { readonly ok: false; readonly reason: 'not-found' | 'conflict' };

/** The outcome of the `open → spawning` transition that gates a single spawn. */
export type SpawnTransition =
  | { readonly ok: true; readonly table: CasualTable }
  | { readonly ok: false; readonly reason: 'not-found' | 'conflict' };

/** The Redis-backed casual-table store. */
export interface CasualTableStore {
  create(variant: VariantView, hostPlayerId: string): Promise<CasualTable>;
  get(id: string): Promise<CasualTable | null>;
  listOpen(input: CursorPaginationInput): Promise<Paginated<CasualTable>>;
  /** Atomically fill an empty seat; `conflict` if taken/closed, `not-found` if absent. */
  claimSeat(id: string, seat: number, occupant: Exclude<TableSeat, { kind: 'empty' }>): Promise<ClaimOutcome>;
  /** Free the caller's seat; evicts and returns `null` when no human remains. */
  releaseSeat(id: string, playerId: string): Promise<CasualTable | null>;
  /** Transition `open → spawning` (and drop from the open listing); gates a single spawn. */
  markSpawning(id: string): Promise<SpawnTransition>;
  /** Transition `spawning → live`, stamping the room handle. */
  markLive(id: string, roomId: string): Promise<CasualTable | null>;
  /** Roll a failed spawn back `spawning → open` (re-listed). */
  rollbackToOpen(id: string): Promise<CasualTable | null>;
  /** Record the player's currently-live table for `match.getActive`. */
  setActive(playerId: string, tableId: string): Promise<void>;
  /** The player's live table, or `null` (clears a stale pointer). */
  getActive(playerId: string): Promise<CasualTable | null>;
}

/** Options for {@link createCasualTableStore}: the Redis client, TTL, and injectable clock/id. */
export interface CasualTableStoreOptions {
  readonly redis: LobbyRedis;
  readonly ttlSeconds?: number;
  readonly now?: () => number;
  readonly newId?: () => string;
}

const OPEN_SET = 'lobby:open';
const DEFAULT_TTL_SECONDS = 3600;

const tableKey = (id: string): string => `lobby:table:${id}`;
const activeKey = (playerId: string): string => `lobby:player:${playerId}`;

/**
 * The atomic seat-claim script. Mirrors {@link applyClaim}: read the table, reject
 * unless it is `open` and the target seat exists and is empty, then fill the seat,
 * bump the version, and write back preserving the TTL. Returns the sentinel
 * `NOT_FOUND`/`CONFLICT` or the updated table as JSON.
 */
export const CLAIM_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if (not raw) then return 'NOT_FOUND' end
local t = cjson.decode(raw)
if t.status ~= 'open' then return 'CONFLICT' end
local idx = tonumber(ARGV[1]) + 1
local seat = t.seats[idx]
if seat == nil then return 'NOT_FOUND' end
if seat.kind ~= 'empty' then return 'CONFLICT' end
t.seats[idx] = cjson.decode(ARGV[2])
t.version = t.version + 1
redis.call('SET', KEYS[1], cjson.encode(t), 'KEEPTTL')
return cjson.encode(t)
`.trim();

/**
 * Pure mirror of {@link CLAIM_SCRIPT} (also used by the test fake's `eval`): the
 * read-check-write a seat claim performs. Returns the updated table or a typed reason.
 */
export function applyClaim(table: CasualTable, seat: number, occupant: TableSeat): CasualTable | 'not-found' | 'conflict' {
  if (table.status !== 'open') {
    return 'conflict';
  }
  const current = table.seats[seat];
  if (current === undefined) {
    return 'not-found';
  }
  if (current.kind !== 'empty') {
    return 'conflict';
  }
  const seats = table.seats.map((existing, index) => (index === seat ? occupant : existing));
  return { ...table, seats, version: table.version + 1 };
}

/**
 * Parse a stored/returned value (object or JSON string) into a validated {@link CasualTable}.
 *
 * The atomic {@link CLAIM_SCRIPT} round-trips the record through Redis `cjson`, which
 * decodes JSON `null` to Lua `nil` and then *omits* nil-valued keys on re-encode — so a
 * table written with `roomId: null` (every table before it goes `live`) comes back with
 * `roomId` absent. The schema accepts `null` but not a missing key, so we restore the
 * `roomId: null` default before validating; an actual room handle in the record overrides it.
 */
function parseTable(value: unknown): CasualTable {
  const json = typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
  const restored = typeof json === 'object' && json !== null ? { roomId: null, ...json } : json;
  return CasualTableSchema.parse(restored);
}

/** A lexicographically-sortable list cursor encoding `createdAt` then `id`. */
function cursorKey(table: CasualTable): string {
  return `${table.createdAt.toString().padStart(16, '0')}:${table.id}`;
}

/** Construct the Redis-backed casual-table store. */
export function createCasualTableStore(options: CasualTableStoreOptions): CasualTableStore {
  const { redis } = options;
  const ttl = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const now = options.now ?? Date.now;
  const newId = options.newId ?? randomUUID;

  async function read(id: string): Promise<CasualTable | null> {
    const raw = await redis.get(tableKey(id));
    return raw === null || raw === undefined ? null : parseTable(raw);
  }

  async function write(table: CasualTable): Promise<void> {
    await redis.set(tableKey(table.id), table, { ex: ttl });
  }

  return {
    async create(variant, hostPlayerId) {
      const seats: TableSeat[] = Array.from({ length: variant.seating.playerCount }, (_unused, index) =>
        index === 0 ? { kind: 'human', playerId: hostPlayerId } : { kind: 'empty' },
      );
      const table: CasualTable = {
        id: newId(),
        variantId: variant.id,
        variant,
        status: 'open',
        seats,
        roomId: null,
        createdAt: now(),
        version: 0,
      };
      await write(table);
      await redis.sadd(OPEN_SET, table.id);
      return table;
    },

    get: read,

    async listOpen({ cursor, limit }) {
      const ids = await redis.smembers(OPEN_SET);
      const tables: CasualTable[] = [];
      for (const id of ids) {
        const table = await read(id);
        if (table === null || table.status !== 'open') {
          await redis.srem(OPEN_SET, id);
          continue;
        }
        tables.push(table);
      }
      tables.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
      const after = cursor === undefined ? tables : tables.filter((table) => cursorKey(table) > cursor);
      const items = after.slice(0, limit);
      const nextCursor = after.length > limit ? cursorKey(items[items.length - 1]!) : null;
      return { items, nextCursor };
    },

    async claimSeat(id, seat, occupant) {
      const result = await redis.eval(CLAIM_SCRIPT, [tableKey(id)], [seat, JSON.stringify(occupant)]);
      if (result === 'NOT_FOUND') {
        return { ok: false, reason: 'not-found' };
      }
      if (result === 'CONFLICT') {
        return { ok: false, reason: 'conflict' };
      }
      return { ok: true, table: parseTable(result) };
    },

    async releaseSeat(id, playerId) {
      const table = await read(id);
      if (table === null) {
        return null;
      }
      const seats = table.seats.map((seat): TableSeat => (seat.kind === 'human' && seat.playerId === playerId ? { kind: 'empty' } : seat));
      if (!seats.some((seat) => seat.kind === 'human')) {
        await redis.del(tableKey(id));
        await redis.srem(OPEN_SET, id);
        return null;
      }
      const next: CasualTable = { ...table, seats, version: table.version + 1 };
      await write(next);
      return next;
    },

    async markSpawning(id) {
      const table = await read(id);
      if (table === null) {
        return { ok: false, reason: 'not-found' };
      }
      if (table.status !== 'open') {
        return { ok: false, reason: 'conflict' };
      }
      const next: CasualTable = { ...table, status: 'spawning', version: table.version + 1 };
      await write(next);
      await redis.srem(OPEN_SET, id);
      return { ok: true, table: next };
    },

    async markLive(id, roomId) {
      const table = await read(id);
      if (table === null) {
        return null;
      }
      const next: CasualTable = { ...table, status: 'live', roomId, version: table.version + 1 };
      await write(next);
      return next;
    },

    async rollbackToOpen(id) {
      const table = await read(id);
      if (table === null) {
        return null;
      }
      const next: CasualTable = { ...table, status: 'open', roomId: null, version: table.version + 1 };
      await write(next);
      await redis.sadd(OPEN_SET, id);
      return next;
    },

    async setActive(playerId, tableId) {
      await redis.set(activeKey(playerId), tableId, { ex: ttl });
    },

    async getActive(playerId) {
      const tableId = await redis.get(activeKey(playerId));
      if (typeof tableId !== 'string' || tableId === '') {
        return null;
      }
      const table = await read(tableId);
      if (table === null || table.status !== 'live') {
        await redis.del(activeKey(playerId));
        return null;
      }
      return table;
    },
  };
}
