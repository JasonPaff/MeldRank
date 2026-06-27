import type { RoomLifecycle } from './types';

/**
 * The room lifecycle state machine (spec: match-room-lifecycle, "Room lifecycle
 * state machine"). The room advances only along the ordered path
 * `Reserved → Filling → Live → Complete → Persisted → Disposed`; every other
 * transition is rejected.
 *
 * The one documented branch off the strict +1 path is **early teardown**: a room
 * that never went `Live` (still `Reserved` or `Filling`) may dispose directly, per
 * "a room that never fills … is permitted to dispose." A room that *did* go live
 * must run out through `Complete → Persisted` first — so `Live → Disposed`
 * (skipping `Complete`) is rejected, exactly as the spec's out-of-order example
 * requires.
 */

/** The ordered lifecycle path; index gives each state its position. */
export const LIFECYCLE_ORDER: readonly RoomLifecycle[] = ['Reserved', 'Filling', 'Live', 'Complete', 'Persisted', 'Disposed'] as const;

/** The states from which early disposal (never having gone `Live`) is permitted. */
const PRE_LIVE_STATES: ReadonlySet<RoomLifecycle> = new Set<RoomLifecycle>(['Reserved', 'Filling']);

/**
 * Report whether `from → to` is a legal room transition. Legal iff `to` is the
 * immediate next state on the ordered path, or it is the early-teardown edge from
 * a pre-live state straight to `Disposed`.
 */
export function isLegalRoomTransition(from: RoomLifecycle, to: RoomLifecycle): boolean {
  const fromIndex = LIFECYCLE_ORDER.indexOf(from);
  const toIndex = LIFECYCLE_ORDER.indexOf(to);
  if (fromIndex < 0 || toIndex < 0) {
    return false;
  }
  if (toIndex === fromIndex + 1) {
    return true;
  }
  return to === 'Disposed' && PRE_LIVE_STATES.has(from);
}

/**
 * Apply a lifecycle transition, returning the new lifecycle marker, or `null` when
 * the transition is illegal (the caller then leaves the room in its current
 * state). This is the single chokepoint for lifecycle progression.
 */
export function advanceLifecycle(from: RoomLifecycle, to: RoomLifecycle): RoomLifecycle | null {
  return isLegalRoomTransition(from, to) ? to : null;
}
