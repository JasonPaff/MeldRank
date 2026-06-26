import type { PlayerIntent } from '@meldrank/shared';

/**
 * The closed `Event` union the reducer folds over, per "API Surface" §4 and
 * design decision 2. It is the locked player **intents** (`bid`, `pass`,
 * `declareTrump`, `playCard`, and the bury-variant-only `bury` — consumed
 * type-only from `@meldrank/shared`) plus the two system events that have no
 * player intent: `deal`, carrying the shuffle seed, and `timeout`, a clock expiry
 * for the seat to act. Modelling the deal
 * and the timeout as events keeps `reduce` total over everything that mutates a
 * hand, so a replay is a clean fold over `(intents ∪ seeds)` with no side
 * channel.
 */

/**
 * The system `deal` event: the seed Match Runtime derived (provably fairly) for
 * this deal. The engine expands it deterministically into the shuffle, so the
 * deal replays from the seed alone.
 */
export interface DealEvent {
  readonly type: 'deal';
  readonly seed: number;
}

/** The system `timeout` event: the clock for `seat` expired. */
export interface TimeoutEvent {
  readonly type: 'timeout';
  readonly seat: number;
}

/** A system event injected by the runtime rather than a player. */
export type SystemEvent = DealEvent | TimeoutEvent;

/** The closed union of player intents and system events the reducer accepts. */
export type Event = PlayerIntent | SystemEvent;

/** The discriminant kind of an {@link Event}. */
export type EventKind = Event['type'];

/**
 * The exact set of the seven documented event kinds, as runtime values (the
 * intent types from `@meldrank/shared` are erased at build, so the enumeration
 * lives here in the engine). The type assertion below pins this list to the
 * `Event` union: adding or removing a kind without updating the other fails to
 * compile.
 */
export const EVENT_KINDS = ['bid', 'pass', 'declareTrump', 'playCard', 'bury', 'deal', 'timeout'] as const satisfies readonly EventKind[];

// Compile-time exhaustiveness guard: every `EventKind` appears in `EVENT_KINDS`.
type AssertAllKindsListed = Exclude<EventKind, (typeof EVENT_KINDS)[number]>;
const _allKindsListed: AssertAllKindsListed extends never ? true : never = true;
void _allKindsListed;
