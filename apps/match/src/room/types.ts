import type { FilteredView, State } from '@meldrank/engine';
import type { SeatContribution } from '@meldrank/fairness';
import type { PlayerIntent, ReplayBlobV1, VariantDefinition } from '@meldrank/shared';

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
 * accepts joins; `Live` runs the per-hand loop; `Complete` is the finished match
 * (which emits a `persist` effect carrying the assembled record); `Persisted` means
 * the match is **durably written** — reached only after the adapter confirms the
 * Neon write; `Disposed` is the torn-down room.
 */
export type RoomLifecycle = 'Reserved' | 'Filling' | 'Live' | 'Complete' | 'Persisted' | 'Disposed';

/**
 * A seat's transport connection status (design D1): `Connected` is a live human,
 * `Disconnected` is a dropped seat inside its reconnection grace window (its
 * assignment retained so it can be reclaimed), and `BotControlled` is a casual seat
 * whose grace expired and was handed to the stubbed bot-takeover seating contract
 * (reclaimable by the returning human). Carried on the seat itself rather than in a
 * parallel registry so the existing seat-indexed helpers and broadcasts carry it.
 */
export type SeatConnectionStatus = 'Connected' | 'Disconnected' | 'BotControlled';

/**
 * A seated connection's stable assignment: its `seatIndex` (the `viewer` used for
 * every per-seat projection), the transport `connectionId`, and a **stubbed**
 * `token` standing in for real seat identity. Clerk-backed identity and
 * reconnection tokens are deferred to later slices.
 *
 * It also carries the seat's authoritative move-clock banks (spec:
 * match-move-clocks, design D2): `remainingBaseMs` is the per-move base allotment
 * for the seat's *current* turn (granted fresh each turn, never carried over),
 * `remainingReserveMs` is the non-refilling reserve bank (drawn down only once the
 * turn's base is exhausted, persisting across turns), and `timeoutCount` tallies
 * the seat's accrued clock timeouts (the basis for the abandonment signal).
 *
 * Disconnect/abandonment fields (design D1): `connectionStatus` tracks the seat's
 * transport state, and `graceDeadline` is the injected-clock deadline at which a
 * `Disconnected` seat's reconnection window expires (`null` when the seat is
 * connected or no grace is running).
 */
export interface SeatAssignment extends SeatClock {
  readonly seatIndex: number;
  readonly connectionId: string;
  readonly token: string;
  readonly timeoutCount: number;
  readonly connectionStatus: SeatConnectionStatus;
  readonly graceDeadline: number | null;
}

/**
 * The mutable clock banks of a single seat (design D2): the structural subset the
 * pure {@link SeatAssignment} carries and the pure `clock.ts` charge/grant/deadline
 * functions operate over. Kept separate so the clock arithmetic never depends on
 * seat identity or transport fields.
 */
export interface SeatClock {
  /** Remaining per-move base allotment for the seat's current turn (ms). */
  readonly remainingBaseMs: number;
  /** Remaining non-refilling reserve bank (ms); spent only after base is gone. */
  readonly remainingReserveMs: number;
}

/**
 * The injected time seam (design D1): a function returning the current monotonic
 * time in milliseconds, mirroring {@link ServerSeedSource}. The pure `RoomCore`
 * obtains "now" only through this seam, never by reading a wall clock, so every
 * deadline computation is deterministic and reproducible under a test clock; the
 * Colyseus adapter wires it to its real monotonic timer.
 */
export type Clock = () => number;

/**
 * The room's move-clock configuration (design D6). Carried on the room so ranked
 * and casual profiles can diverge later without a spec or code change; both share
 * one default today ({@link DEFAULT_CLOCK_CONFIG}). `baseMs`/`reserveMs` are the
 * per-move base allotment and the per-player reserve bank; `contributionWindowMs`
 * bounds the provably-fair contribution window; `timeoutAbandonThreshold` is the
 * accrued-timeout count at which a ranked room emits the abandonment signal.
 */
export interface ClockConfig {
  readonly baseMs: number;
  readonly reserveMs: number;
  readonly contributionWindowMs: number;
  readonly timeoutAbandonThreshold: number;
  /**
   * The reconnection grace window (ms) stamped on a seat that drops while `Live`
   * (design D3, default 90_000). Carried on the config next to the clock banks so
   * ranked and casual profiles can diverge without a spec change.
   */
  readonly reconnectGraceMs: number;
}

/** A single seat's clock banks in a broadcast snapshot (spec: per-seat clock state). */
export interface SeatClockSnapshot extends SeatClock {
  readonly seat: number;
}

/**
 * The room's currently-pending deadline (design D2/D3): the **earliest** of the
 * acting seat's turn expiry, the open contribution window's close, and every
 * disconnected seat's reconnection grace deadline. The adapter reads this after every
 * step to (re)arm its single wall-clock timer; `null` when nothing is on the clock. A
 * `'grace'` deadline carries the `seat` whose window it is, so the adapter can route
 * the fire to `expireGrace` for that seat.
 */
export interface PendingDeadline {
  readonly at: number;
  readonly kind: 'turn' | 'contribution' | 'grace';
  /** The disconnected seat whose grace window this is (only for `kind: 'grace'`). */
  readonly seat?: number;
}

/**
 * Why a `Live` match terminated early through abandonment handling (design D5/D9;
 * capability `match-disconnect-abandonment`): a single-seat forfeit on grace expiry
 * (`forfeit_abandon`) or on crossing the ranked repeated-timeout threshold
 * (`timeout_abandon`), or a multi-drop/crash `aborted` with no rating change.
 */
export type ResolutionReason = 'forfeit_abandon' | 'timeout_abandon' | 'aborted';

/**
 * A per-seat abandonment outcome **label** (design D5), not a rating number: the
 * rating math that consumes these lives in a later slice. `abandoner_loss` is the
 * seat that left (never softer than a played-out loss); `stranded_partner_reduced_loss`
 * is the abandoner's protected partner; `opponent_win` is a normal win for an opposing
 * seat; `no_result` is every seat in an aborted match (nobody charged).
 */
export type SeatOutcomeLabel = 'abandoner_loss' | 'stranded_partner_reduced_loss' | 'opponent_win' | 'no_result';

/** A single seat's abandonment outcome (design D5). */
export interface SeatOutcome {
  readonly seat: number;
  readonly outcome: SeatOutcomeLabel;
}

/**
 * The terminal abandonment resolution carried on the room (design D9): the reason and
 * the per-seat outcomes. Set by the resolution functions and read by a future
 * persistence slice; `null` until the match resolves through abandonment handling.
 */
export interface ResolutionState {
  readonly reason: ResolutionReason;
  readonly outcomes: readonly SeatOutcome[];
}

/**
 * The durable per-seat outcome normalized to the `participant_outcome` vocabulary
 * (design D3): the room's richer abandonment labels and the engine's played-out
 * win/loss both collapse into `win`/`loss`/`no_result` for the persisted record and
 * the result event.
 */
export type MatchOutcomeLabel = 'win' | 'loss' | 'no_result';

/** A single seat's normalized match outcome, carried in the assembled record. */
export interface MatchOutcome {
  readonly seat: number;
  readonly outcome: MatchOutcomeLabel;
}

/**
 * Why a match resolved, as written to `matches.resolution_reason` (design D3): the
 * room's {@link ResolutionReason} for an abandonment, plus `played_out` for a
 * naturally scored-out match.
 */
export type MatchResolutionReason = ResolutionReason | 'played_out';

/**
 * One side's as-scored line for a hand (design D1): the plain projector-input line
 * the writer feeds straight to `projectHand()` with no engine-type coupling.
 */
export interface HandRecordLine {
  readonly side: number;
  readonly meld: number;
  readonly counters: number;
  readonly total: number;
}

/**
 * A per-hand summary harvested at the scoring boundary (design D1). Mirrors
 * `ProjectHandInput` exactly so the writer hands it straight to `projectHand()`: the
 * bidding context, the made/set verdict, the per-side as-scored `lines`, and the
 * cumulative-by-side totals after the hand. A plain, serializable value object.
 */
export interface HandRecord {
  readonly handNumber: number;
  readonly bidderSeat: number;
  readonly contractValue: number;
  readonly trump: string;
  readonly made: boolean;
  readonly lines: readonly HandRecordLine[];
  readonly cumulativeBySide: Readonly<Record<number, number>>;
}

/**
 * One entry in the ordered intent log (design D1, replay-only): the acting seat and
 * either the accepted player `intent` or a forced-timeout marker
 * (`forcedTimeout: true`, `intent: null`). Appended in occurrence order.
 */
export interface IntentLogEntry {
  readonly seat: number;
  readonly intent: PlayerIntent | null;
  readonly forcedTimeout: boolean;
}

/**
 * A hand's captured seed reveal (design D1, replay-only): the per-hand nonce, the
 * (now safe to retain) server seed, its published commitment, and the seat
 * contributions that fed the deal. Captured before the handshake is cleared; it only
 * ever surfaces inside the durable replay blob written at match end.
 */
export interface HandReveal {
  readonly handNonce: number;
  readonly serverSeed: Uint8Array;
  readonly commit: Uint8Array;
  readonly contributions: readonly SeatContribution[];
}

/**
 * The in-memory match-record accumulator (design D1): the data the engine and the
 * shuffle handshake discard as the match advances, captured into the room's own
 * state as it occurs so the full record exists when the match ends. `startedAt` is
 * the injected-clock instant the room went `Live`; `hands` is one plain
 * projector-input per scored hand; `intents` and `reveals` are replay-only.
 */
export interface MatchRecordAccumulator {
  readonly startedAt: number | null;
  readonly hands: readonly HandRecord[];
  readonly intents: readonly IntentLogEntry[];
  readonly reveals: readonly HandReveal[];
}

/**
 * The self-describing match envelope (design D2/D4): the `matches`-row fields derived
 * in the pure core so the writer is dumb. `variantSnapshot` is the full definition
 * and `variantHash` its stable content hash; `variantId`/`variantVersion` stay null
 * for ad-hoc casual. `startedAt`/`completedAt` are injected-clock epoch ms.
 */
export interface MatchRecordEnvelope {
  readonly mode: 'ranked' | 'casual';
  readonly status: 'complete' | 'aborted';
  readonly resolutionReason: MatchResolutionReason;
  readonly variantId: string | null;
  readonly variantVersion: number | null;
  readonly variantSnapshot: VariantDefinition;
  readonly variantHash: string;
  readonly startedAt: number | null;
  readonly completedAt: number;
}

/**
 * The fully-assembled, DB-id-free match record (design D2) carried on the `persist`
 * effect: the envelope, the per-hand `HandRecord`s (the writer folds each through
 * `projectHand()`), the per-seat normalized outcomes (for the result event), and the
 * versioned replay blob (the writer serializes it to `bytea`). The adapter performs
 * the IO and supplies the generated match id.
 */
export interface MatchRecord {
  readonly match: MatchRecordEnvelope;
  readonly hands: readonly HandRecord[];
  readonly outcomes: readonly MatchOutcome[];
  readonly replay: ReplayBlobV1;
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
  /** The room's move-clock configuration (design D6). */
  readonly config: ClockConfig;
  /** Whether this is a ranked room — gates the abandonment signal (design D7). */
  readonly ranked: boolean;
  /**
   * The injected time the current acting seat began its turn (design D2), or `null`
   * when no seat is on the clock (between hands, during a non-acting phase, or before
   * the first deal). The acting seat's deadline is derived from this plus its banks.
   */
  readonly turnStartedAt: number | null;
  /**
   * The injected time the open contribution window closes (design D5), or `null` when
   * no commit window is open. Past this, late contributions are rejected and the deal
   * proceeds with the deterministic fallback for any absent seat.
   */
  readonly contributionDeadline: number | null;
  /**
   * The terminal abandonment resolution (design D9; capability
   * `match-disconnect-abandonment`), or `null` while the match is unresolved. Set by
   * the forfeit/abort functions and read at completion to derive the persisted
   * record's status/reason/outcomes; a resolved room accepts no intents.
   */
  readonly resolution: ResolutionState | null;
  /**
   * The in-memory match-record accumulator (design D1; capability
   * `match-persistence`): per-hand summaries, the ordered intent log, and seed
   * reveals captured while `Live`, plus the `startedAt` stamp. Read at completion to
   * assemble the `MatchRecord` carried on the `persist` effect.
   */
  readonly record: MatchRecordAccumulator;
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
export type ContributionRejectReason = 'room-not-live' | 'not-seated' | 'no-open-commit' | 'already-contributed' | 'window-closed';

/** Reason a join was rejected (spec: match-room-lifecycle, seat filling). */
export type JoinRejectReason = 'disposed' | 'room-full' | 'seat-occupied' | 'already-seated';

/**
 * An outbound message the room must send. Most effects are addressed to a single
 * `connectionId`, and the Colyseus adapter's job is to translate each into a
 * `client.send`. Per-recipient `view`/`accept`/`reject`/`clockState` effects carry
 * the recipient's own payload computed at send time, so the adapter never re-derives
 * or re-shares it across seats (spec: per-recipient filtered broadcast). The
 * exceptions are the **server-side signals** identifying a seat or carrying a
 * resolution rather than a per-connection payload — `abandonmentSignal` (design
 * D7), `abandonResolution` (the terminal result, design D5/D9), `abandonEvent` (the
 * leaver-penalty hook), `botTakeoverRequested` (the stubbed casual seating
 * contract, design D8), and `persist` (the assembled match record the adapter writes
 * to Neon, capability `match-persistence`) — forwarded by the adapter to their
 * consumers rather than to a client.
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
  | { readonly kind: 'rejectContribution'; readonly connectionId: string; readonly reason: ContributionRejectReason }
  | {
      readonly kind: 'clockState';
      readonly connectionId: string;
      /** The seat currently on the clock, or `null` when no seat is acting. */
      readonly actingSeat: number | null;
      /** The acting seat's authoritative expiry (injected ms), or `null` when none. */
      readonly deadline: number | null;
      /** Every seat's clock banks, so the table UI can render all countdowns. */
      readonly seats: readonly SeatClockSnapshot[];
    }
  | { readonly kind: 'abandonmentSignal'; readonly seat: number; readonly timeoutCount: number }
  | { readonly kind: 'abandonResolution'; readonly reason: ResolutionReason; readonly outcomes: readonly SeatOutcome[] }
  | { readonly kind: 'abandonEvent'; readonly seat: number; readonly reason: ResolutionReason }
  | { readonly kind: 'botTakeoverRequested'; readonly seat: number }
  | { readonly kind: 'persist'; readonly record: MatchRecord };

/** The result of any `RoomCore` step: the next state plus the effects to emit. */
export interface StepResult {
  readonly state: RoomCoreState;
  readonly effects: readonly Effect[];
}

/** The outcome of a join attempt: a seated assignment or a typed rejection. */
export type JoinOutcome =
  | { readonly status: 'seated'; readonly seat: number }
  | { readonly status: 'rejected'; readonly reason: JoinRejectReason };

/** A join step's result: the next state, the effects, and the seating outcome. */
export interface JoinResult extends StepResult {
  readonly outcome: JoinOutcome;
}

/** Re-export the wire intent type for adapter convenience. */
export type { PlayerIntent };
