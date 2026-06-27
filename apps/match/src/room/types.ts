import type { FilteredView, State } from '@meldrank/engine';
import type { SeatContribution } from '@meldrank/fairness';
import type { PlayerIntent, VariantDefinition } from '@meldrank/shared';

/**
 * The pure `RoomCore` data model (design D2). Every type here is a plain,
 * structurally-immutable value: the lifecycle machine, the seat assignments, the
 * authoritative engine `State`, and the per-hand shuffle-handshake context all
 * live as data so the room's decision logic is a set of pure functions
 * (`(state, input) → { state, effects }`) that need no socket to exercise. The
 * Colyseus `Room` is a thin adapter over these functions.
 */

/**
 * The room lifecycle marker, advancing only along the ordered path
 * `Reserved → Filling → Live → Complete → Persisted → Disposed`
 * (spec: match-room-lifecycle). `Reserved` is created-but-unseated; `Filling`
 * accepts joins; `Live` runs the per-hand loop; `Complete` is the finished match;
 * `Persisted` is an **inert** placeholder transition in this slice (no durable
 * write — real persistence is slice #6); `Disposed` is the torn-down room.
 */
export type RoomLifecycle = 'Reserved' | 'Filling' | 'Live' | 'Complete' | 'Persisted' | 'Disposed';

/**
 * A seated connection's stable assignment: its `seatIndex` (the `viewer` used for
 * every per-seat projection), the transport `connectionId`, and a **stubbed**
 * `token` standing in for real seat identity. Clerk-backed identity and
 * reconnection tokens are deferred to later slices.
 */
export interface SeatAssignment {
  readonly seatIndex: number;
  readonly connectionId: string;
  readonly token: string;
}

/**
 * The per-hand provably-fair handshake context (spec: match-shuffle-handshake).
 * Created when a hand's deal window opens: it carries the secret `serverSeed`
 * (committed but **never** broadcast), the published `commit` hash, the hand's
 * `handNonce` (mixed into seed assembly so each hand derives an independent seed),
 * and the seat `contributions` collected so far. `null` between hands (no open
 * commit window).
 */
export interface HandshakeContext {
  readonly handNonce: number;
  /** The committed secret. Stays server-side; only {@link HandshakeContext.commit} is published. */
  readonly serverSeed: Uint8Array;
  /** The published commitment hash broadcast to every seat before the deal. */
  readonly commit: Uint8Array;
  /** Accepted seat contributions, recorded by arrival; assembly indexes them by seat. */
  readonly contributions: readonly SeatContribution[];
}

/**
 * The complete authoritative room state. `engine` is the single source of truth
 * held server-side (never serialized whole to a client); it is `null` only after
 * disposal, when the engine state is released. `handsDealt` is the monotonic
 * hand-nonce source.
 */
export interface RoomCoreState {
  readonly lifecycle: RoomLifecycle;
  readonly variant: VariantDefinition;
  readonly seatCount: number;
  readonly seats: readonly SeatAssignment[];
  readonly engine: State | null;
  readonly handshake: HandshakeContext | null;
  readonly handsDealt: number;
}

/**
 * The entropy seam for a hand's server seed (design D6): a function returning 32
 * fresh random bytes. Production wires it to `crypto.getRandomValues`; tests
 * inject a deterministic source so the whole handshake-and-deal loop is
 * reproducible. Keeping it an injected parameter is what lets `RoomCore` stay a
 * pure, deterministic function of its inputs.
 */
export type ServerSeedSource = () => Uint8Array;

/** Machine-readable reason an intent was rejected (design D4; spec: match-intent-loop). */
export type IntentRejectReason = 'room-not-live' | 'not-seated' | 'not-your-seat' | 'out-of-turn' | 'illegal-move';

/** Machine-readable reason a seat contribution was rejected (spec: match-shuffle-handshake). */
export type ContributionRejectReason = 'room-not-live' | 'not-seated' | 'no-open-commit' | 'already-contributed';

/** Reason a join was rejected (spec: match-room-lifecycle, seat filling). */
export type JoinRejectReason = 'disposed' | 'room-full' | 'seat-occupied' | 'already-seated';

/**
 * An outbound message the room must send, addressed to a single `connectionId`.
 * The Colyseus adapter's only job is to translate each effect into a
 * `client.send`. Per-recipient `view`/`accept`/`reject` effects already carry the
 * recipient's own `viewFor` projection computed at send time, so the adapter
 * never re-derives or re-shares a payload across seats (spec: per-recipient
 * filtered broadcast).
 */
export type Effect =
  | { readonly kind: 'view'; readonly connectionId: string; readonly view: FilteredView }
  | { readonly kind: 'commit'; readonly connectionId: string; readonly handNonce: number; readonly commit: Uint8Array }
  | { readonly kind: 'accept'; readonly connectionId: string; readonly correlationId: string; readonly view: FilteredView }
  | {
      readonly kind: 'reject';
      readonly connectionId: string;
      readonly correlationId: string;
      readonly reason: IntentRejectReason;
      readonly view: FilteredView;
    }
  | { readonly kind: 'rejectContribution'; readonly connectionId: string; readonly reason: ContributionRejectReason };

/** The result of any `RoomCore` step: the next state plus the effects to emit. */
export interface StepResult {
  readonly state: RoomCoreState;
  readonly effects: readonly Effect[];
}

/** The outcome of a join attempt: a seated assignment or a typed rejection. */
export type JoinOutcome = { readonly status: 'seated'; readonly seat: number } | { readonly status: 'rejected'; readonly reason: JoinRejectReason };

/** A join step's result: the next state, the effects, and the seating outcome. */
export interface JoinResult extends StepResult {
  readonly outcome: JoinOutcome;
}

/** Re-export the wire intent type for adapter convenience. */
export type { PlayerIntent };
