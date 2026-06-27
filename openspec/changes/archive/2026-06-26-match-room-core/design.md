## Context

The engine (`packages/engine`) is a complete, pure, exhaustively-tested `reduce(state, event)` core with a per-seat `viewFor` projection (slice #0) and a provably-fair `@meldrank/shared/fairness` commit–reveal layer (slice #1). `apps/match` is still a boot stub that only proves it can import `@meldrank/shared` and listen on a port. This change is slice #2 of the Match Runtime — Spec Slicing Plan: the keystone that turns the pure engine into a live, networked, server-authoritative table on Colyseus/Fly.io.

The defining constraint, from Match Runtime — Design v1 §4 and the locked Technical Architecture, is **hidden-information integrity**: the server is the sole authority and a client must never receive another seat's cards or the unrevealed widow. The engine already structures `State` into `PublicState` + per-seat `PrivateState` precisely so the Match Service's filtering is a mechanical `viewFor` projection. This slice must honor that boundary at the transport layer — which shapes the central Colyseus decision below.

## Goals / Non-Goals

**Goals:**
- Stand up a real Colyseus room hosting one authoritative engine `State` per table.
- Implement the room lifecycle `Reserved → Filling → Live → Complete → Persisted → Disposed` and the per-hand deal loop.
- Implement the authoritative `validate → apply → advance → broadcast` intent loop with per-recipient `viewFor` projection at send time.
- Define an optimistic/authoritative wire protocol with accept/reject acknowledgements and corrective resync.
- Enforce the provably-fair handshake each hand: commit broadcast pre-deal, contribute-after-commit, deterministic fallback, `assembleSeed → rngFromSeed` into the Dealer's `rng` seam.
- Keep the lifecycle + intent logic **pure and unit-testable**, with Colyseus as a thin transport adapter.

**Non-Goals (later slices — do not build here):**
- Move clocks/timers (#3), disconnect/reconnect/abandonment (#4), bots-in-room (#5).
- Durable persistence + result emission to Postgres/Redis (#6): the `Persisted` transition is inert.
- Clerk-backed identity and reconnection tokens (seat identity is a stub token).
- The reveal/verify side of fairness over the wire (post-hand reveal emission is part of #6's replay payload); this slice only does commit + contribute + seed assembly to drive the deal.

## Decisions

### D1: Keep authoritative engine `State` server-side; push per-seat `FilteredView` as messages — do **not** sync game state via Colyseus schema

Colyseus's headline feature is automatic state synchronization: mutate a `@colyseus/schema` room state and it diffs and broadcasts to **all** clients. That is exactly wrong here — it would leak every seat's hand to every client. So the room holds the engine `State` as a plain server-side field (it is already JSON-round-trippable by design) and sends each connection its own `viewFor(state, seat)` payload as an explicit room message. We deliberately use Colyseus for transport, room lifecycle hosting, and matchmaking — **not** for game-state replication.
- *Alternative considered:* mirror `State` into a Colyseus schema and use per-client filtering hooks. Rejected: it fights the framework's broadcast model, and a filtering bug would silently leak hidden info — the opposite of "hidden info is unrepresentable." Explicit per-seat messages keep `viewFor` the single chokepoint.
- A **minimal** Colyseus schema MAY carry only non-secret room metadata (lifecycle state, seat occupancy, current `seatToAct`) for cheap presence; anything card-bearing goes through `viewFor` messages only.

### D2: A pure `RoomCore` owns lifecycle + intent loop; the Colyseus `Room` is a thin adapter

Consistent with the project's pure-and-tested-first principle, the lifecycle state machine and the `validate → apply → advance → broadcast` decision logic live in a pure, dependency-free module (`apps/match/src/room/`) that takes the current room/engine state and an input and returns the next state plus a list of outbound effects (per-seat view, ack, commit broadcast). The Colyseus `Room` subclass is a thin shell that wires `onJoin`/`onMessage`/`onLeave` to `RoomCore` and performs the actual sends. This keeps the integrity-critical loop unit-testable without standing up a socket.
- *Alternative considered:* put logic directly in the Colyseus `Room`. Rejected: couples tests to the transport and makes the move loop hard to exercise deterministically.

### D3: Intents map to engine `Event`s; the engine remains the validation authority

The room wraps an incoming `PlayerIntent` into the engine `Event` union and calls `reduce`. Authority checks the room owns (seat-ownership and `seatToAct`) run **before** `reduce`; all rule legality (legal play, bid legality, phase gating) is delegated to the engine, which already rejects illegal events. The room never re-implements game rules.
- This means "validate" is two layers: room-level authority (is this connection allowed to act as this seat, now?) then engine-level legality (is this move legal in this state?).

### D4: Optimistic reconciliation via per-intent correlation IDs

Each submitted intent carries a client-generated correlation id. The room replies with an `accept` (correlation id + the submitter's authoritative resulting view) or a `reject` (correlation id + machine-readable reason + a fresh authoritative view to resync against). Clients apply moves optimistically and reconcile on the correlated ack — roll forward on accept, roll back to the resync on reject. The authoritative broadcast to *other* seats is a separate fan-out.
- *Alternative considered:* no correlation, clients diff against the next broadcast. Rejected: a client can't tell which of several in-flight predictions a broadcast resolves, making rollback ambiguous.

### D5: Shuffle handshake is gated on lifecycle, not on a clock

Per hand: enter the deal sub-step → `commit` and broadcast the hash → open the contribution window → assemble and deal. Because move clocks are slice #3, this slice does not impose a timed contribution deadline; the window closes when all seated connections have contributed (deterministic for tests) or, for connections that never contribute, the fairness layer's `fallbackContribution` is substituted at assembly time. The exact production policy for *when* to stop waiting without a clock is an open question (below); the integrity property (fallback yields the server no extra control) holds regardless.
- The reveal payload (revealed seeds for replay) is assembled by the fairness layer but its **emission** is deferred to persistence (#6); this slice only needs commit + contribute + assemble to drive a reproducible deal.

### D6: Colyseus + `@colyseus/schema` added at latest stable; seat identity stubbed

`apps/match` gains `colyseus` (and `@colyseus/schema` for the minimal metadata schema in D1) at the newest stable release, verified against the npm registry at implementation time per the dependency policy. Seat identity is a stub seat token assigned on join; Clerk wiring and reconnection tokens are deferred. `fly.toml` is updated for the room server's runtime shape but full Fly deploy hardening is not in scope.

## Risks / Trade-offs

- **[Per-seat message fan-out costs more than schema diffing]** → Acceptable at v1 table sizes (≤4 seats); `viewFor` is a cheap reference-sharing projection. Revisit only if profiling shows it matters.
- **[Bypassing Colyseus state sync means reimplementing some resync plumbing]** → Mitigated by D2's explicit full-view-on-join and reject-resync; this is a small, well-bounded message set and keeps the integrity chokepoint singular.
- **[No contribution deadline without clocks could stall a deal if a seat never contributes]** → Mitigated by `fallbackContribution` at assembly; the open question is only the production trigger to stop waiting, which slice #3's clocks will formalize. In this slice, deal once every seated connection has contributed-or-fallback-eligible.
- **[Colyseus major-version API drift from the stub's assumptions]** → Pin to verified latest stable and adapt the room API at implementation; the thin-adapter design (D2) confines any churn to the shell.
- **[`Persisted` placeholder could be mistaken for real persistence]** → Spec and code comment it explicitly as inert; #6 owns the durable write and the result/reveal payload.

## Migration Plan

Additive only — `apps/match` is a stub with no dependents. Steps: add Colyseus deps → implement `RoomCore` (pure) with tests → wrap in the Colyseus `Room` adapter → register the room and update `fly.toml`/Dockerfile → boot locally and play a hand end-to-end against a stub client. Rollback is reverting the change; no data or external contracts are affected (persistence and API↔Match coupling are #6).

## Open Questions

- **Contribution-window close policy without a clock**: deal as soon as all seated connections have contributed, with `fallbackContribution` only for genuinely absent seats? The timed deadline arrives with slice #3 clocks — confirm the interim trigger is acceptable.
- **Minimal metadata schema scope**: how much non-secret room state (lifecycle, occupancy, `seatToAct`) is worth putting in a Colyseus schema for presence vs. folding entirely into `viewFor` messages? Lean minimal.
- **Spectator support in this slice**: `viewFor(state, null)` exists; do we accept spectator connections now, or defer joining spectators until a later slice? Default: support the projection, but seating spectators can be deferred.
