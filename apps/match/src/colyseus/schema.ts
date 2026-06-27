import { schema } from '@colyseus/schema';

/**
 * The **minimal, non-secret** Colyseus room state (design D1, task 5.1). Colyseus
 * syncs a room's `@colyseus/schema` state to every connected client automatically —
 * which is exactly why no card-bearing field may live here. This schema carries only
 * presence metadata that is safe for the whole table to see:
 *
 * - `lifecycle` — the room lifecycle marker (`Reserved`, `Filling`, …).
 * - `seatToAct` — the seat currently on the clock, or `-1` when none.
 * - `clockDeadline` — the pending on-clock deadline (injected ms), or `-1` when none.
 * - `occupancy` — per-seat occupancy flags (which seats are filled).
 *
 * All hidden information (hands, the unrevealed widow) is delivered exclusively
 * through per-recipient `viewFor` messages, never this schema. The per-seat clock
 * banks travel on `clockState` messages, not here; `clockDeadline` is only the
 * coarse table-level countdown anchor.
 *
 * Defined via the `schema({...})` factory (no decorators), so it needs no
 * `experimentalDecorators` tsconfig flag.
 */
export const RoomMetadata = schema({
  lifecycle: 'string',
  seatToAct: 'number',
  clockDeadline: 'number',
  occupancy: ['boolean'],
});

/** The instance type of the room metadata schema. */
export type RoomMetadata = InstanceType<typeof RoomMetadata>;
