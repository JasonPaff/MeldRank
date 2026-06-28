import { TRPCError } from '@trpc/server';
import type { CasualTable, RoomSpawnRequest, SignedSeatTicket, SpawnSeat } from '@meldrank/shared';
import type { ApiDeps } from '../trpc';

/**
 * The full-table → spawn flow (capability `casual-lobby-api`, design D1/D3), shared by
 * `joinSeat`, `addBot`, and `quickPlay`. When a table's seats are all occupied it
 * transitions `open → spawning`, requests a room from the match service, and on a
 * returned handle transitions `→ live`, mints a seat ticket for every human seat, and
 * records each human's active match. A spawn failure rolls the table back to `open` and
 * surfaces a standard internal error (not a client-facing taxonomy code, per the
 * shared-contracts error model) — no human seat ticket is issued without a spawned room.
 */

/** The result of a seat-mutating action: the updated table and the caller's ticket (if spawned). */
export interface SpawnFlowResult {
  readonly table: CasualTable;
  readonly ticket: SignedSeatTicket | null;
}

/** Whether every seat is occupied (human or bot). */
export function isFull(table: CasualTable): boolean {
  return table.seats.every((seat) => seat.kind !== 'empty');
}

/**
 * Spawn the room when `table` is full, otherwise pass the table through unchanged. On a
 * full table this is the single trigger (the atomic seat claim guarantees exactly one
 * caller fills the last seat), so the `open → spawning` guard failing means a genuine
 * concurrent state change → surfaced as `conflict`.
 */
export async function spawnIfFull(deps: ApiDeps, table: CasualTable, callerPlayerId: string): Promise<SpawnFlowResult> {
  if (!isFull(table)) {
    return { table, ticket: null };
  }

  const spawning = await deps.store.markSpawning(table.id);
  if (!spawning.ok) {
    throw new TRPCError({ code: 'CONFLICT', message: 'table is no longer open to spawn' });
  }

  let roomId: string;
  try {
    const response = await deps.spawn.spawn(toSpawnRequest(spawning.table));
    roomId = response.roomId;
  } catch {
    await deps.store.rollbackToOpen(table.id);
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'room spawn failed' });
  }

  const live = await deps.store.markLive(table.id, roomId);
  if (live === null) {
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'table missing after spawn' });
  }

  let callerTicket: SignedSeatTicket | null = null;
  for (let seat = 0; seat < live.seats.length; seat++) {
    const occupant = live.seats[seat];
    if (occupant?.kind !== 'human') {
      continue;
    }
    const ticket = deps.tickets.mint({ roomId, seat, playerId: occupant.playerId, variantId: live.variantId });
    await deps.store.setActive(occupant.playerId, live.id);
    if (occupant.playerId === callerPlayerId) {
      callerTicket = ticket;
    }
  }
  return { table: live, ticket: callerTicket };
}

/** Build the API↔Match spawn request from a full casual table. */
export function toSpawnRequest(table: CasualTable): RoomSpawnRequest {
  const seating: SpawnSeat[] = table.seats.map((seat) =>
    seat.kind === 'human' ? { kind: 'human', playerId: seat.playerId } : { kind: 'bot' },
  );
  const bots = table.seats.filter((seat) => seat.kind === 'bot').length;
  return { variantId: table.variantId, variant: table.variant, seating, bots };
}
