## Why

The Game Engine is complete and exhaustively unit-tested as pure functions, but nothing yet runs it as a live, networked, server-authoritative table. This change is slice #2 — the keystone "it's alive" brick — of the Match Runtime — Spec Slicing Plan: it stands up `apps/match` (Colyseus on Fly.io) with one authoritative engine instance per room, so a hand can actually be dealt and played over the wire. Every later runtime slice (clocks, disconnect/abandonment, bots-in-room, persistence) attaches to this room, so it must land first. Per the locked "pure-and-tested-first" principle, the integrity-critical logic it depends on — the per-seat filtered view (#0) and the provably-fair shuffle (#1) — is already implemented and archived, so this is the deliberate point at which the Colyseus/Fly networking layer begins.

## What Changes

- Replace the `apps/match` boot stub with a real Colyseus room type that hosts one authoritative `@meldrank/engine` instance per table — the server is the sole source of truth; clients never receive hidden information.
- Introduce a **room lifecycle state machine**: `Reserved → Filling → Live → (per-hand loop) → Complete → Persisted → Disposed`. `Persisted` is a placeholder transition in this slice (it writes nothing — real persistence is slice #6).
- Introduce the **authoritative intent loop**: for each submitted `PlayerIntent`, the room runs `validate → apply (engine reduce) → advance lifecycle → broadcast`. Illegal or out-of-turn intents are rejected without mutating state.
- Broadcast per recipient through the engine's `viewFor` projection (#0) **at send time**, so each connection only ever receives its own legal information; the room never serializes full `State` to a client.
- Define the **client↔room wire protocol** with optimistic-client / authoritative-server reconciliation: a submitted intent is acknowledged (accepted, with the authoritative resulting view) or rejected (with a reason and a corrective resync), letting clients apply moves optimistically and roll back on rejection.
- Carry forward the **provably-fair shuffle handshake** (#1): before each hand's deal the room broadcasts the `commit` hash to all seats, and accepts a seat's `clientSeed` contribution only *after* the commit is published; absent contributions use the fairness layer's deterministic fallback.
- Seat identity is **stubbed** in this slice (a seat token / index); Clerk wiring and reconnection tokens are deferred to later slices.
- Add the Colyseus runtime dependency to `apps/match` (first use of Colyseus rooms + Fly room config in the repo), at latest stable.

Explicitly **out of scope** (later slices, must not be built here): move clocks/timers (#3), disconnect/reconnect/abandonment (#4), bots-in-room (#5), and match persistence + result emission to Postgres/Redis (#6).

## Capabilities

### New Capabilities
- `match-room-lifecycle`: The Colyseus room hosting one authoritative engine instance per table — room creation, seat filling, the `Reserved → Filling → Live → per-hand loop → Complete → Persisted → Disposed` state machine, the per-hand deal cycle, and room disposal. Bounds what a room *is* in this slice.
- `match-intent-loop`: The server-authoritative `validate → apply → advance → broadcast` move loop, per-recipient filtered-view broadcast via `viewFor`, and the optimistic/authoritative wire protocol (intent submit, accept/reject acknowledgement, corrective resync) that clients reconcile against.
- `match-shuffle-handshake`: The wire-level provably-fair handshake the room enforces each hand — pre-deal `commit` broadcast to all seats, seat `clientSeed` contribution accepted only after commit, deterministic fallback for absent seats — feeding the engine Dealer's `rng` seam through the `@meldrank/shared/fairness` layer.

### Modified Capabilities
<!-- None. This slice consumes seat-view-projector (#0) and provably-fair-shuffle (#1) as-is; it changes no existing spec's requirements. -->

## Impact

- **`apps/match`**: replaces the boot stub with the room implementation, Colyseus room registration, and `fly.toml` room config; adds the `colyseus` runtime dependency (and `@colyseus/schema` for room state) at latest stable.
- **`packages/engine`** (consumed, unchanged): `reduce`/`Event`, `viewFor`/`FilteredView`, lifecycle `resolveActivePath`/`isLegalTransition`, the Dealer `rng` seam, `MatchScorer`.
- **`packages/shared`** (consumed, unchanged): `PlayerIntent` wire types and the `@meldrank/shared/fairness` commit–reveal API (`commit`, `assembleSeed`, `rngFromSeed`, `fallbackContribution`).
- **Deferred dependencies**: Clerk identity (seat tokens stubbed), Postgres/Drizzle + Redis pub/sub (the `Persisted` transition is inert), move clocks, reconnection, and bots — each its own later slice.
- **Infra**: first Colyseus/Fly.io runtime footprint in the repo; establishes the room-server deployment surface later slices extend.
