## 1. Dependencies & app wiring

- [x] 1.1 Add `colyseus` and `@colyseus/schema` to `apps/match` at latest stable (verify against npm registry per the dependency policy), update the lockfile.
- [x] 1.2 Confirm `apps/match` tsconfig path aliases resolve `@meldrank/engine` and `@meldrank/shared` (incl. `/server` and `/fairness`) as TS source; add `@meldrank/engine` to `apps/match` deps if not already wired.

## 2. Pure RoomCore — room state & lifecycle (D2)

- [x] 2.1 Define the `RoomCore` state type: room lifecycle marker (`Reserved | Filling | Live | Complete | Persisted | Disposed`), seat assignments, the authoritative engine `State`, the per-hand shuffle-handshake context, and the `VariantDefinition`.
- [x] 2.2 Implement the lifecycle transition function enforcing the ordered path `Reserved → Filling → Live → Complete → Persisted → Disposed`; reject out-of-order transitions (spec: match-room-lifecycle).
- [x] 2.3 Implement seat filling: assign a stable seat index on join, reject joins when full or onto an occupied seat; model seat identity as a stub seat token.
- [x] 2.4 Implement entry to `Live` once the variant's seat count is reached, and room disposal (release engine state, reject further input once `Disposed`).
- [x] 2.5 Unit-test the lifecycle machine and seating, covering each match-room-lifecycle scenario (fill→live, completion→persisted→disposed, out-of-order rejection, full-room join rejection, stable seat index, disposed rejects input).

## 3. Per-hand deal loop + shuffle handshake (D5)

- [x] 3.1 Implement the per-hand step: `commit` the server seed via `@meldrank/shared/fairness` and produce a commit-broadcast effect to all seats before dealing (spec: match-shuffle-handshake).
- [x] 3.2 Implement the contribution window: accept a seat `clientSeed` (`SeatContribution`) only after that hand's commit; reject contributions before the commit or for a hand with no published commit.
- [x] 3.3 Implement seed assembly: `assembleSeed` over the committed server seed + collected contributions, substituting `fallbackContribution` for absent seats, then `rngFromSeed` into the Dealer `rng` seam to deal the hand.
- [x] 3.4 Drive the variant active path (`resolveActivePath`): after a hand reaches `HandScoring`, deal the next hand (re-running the handshake) or, when `MatchScorer` reports complete, leave the per-hand loop for `Complete`.
- [x] 3.5 Unit-test the handshake and deal loop: commit-precedes-deal, server seed not revealed at commit, contribute-before/after-commit, fallback for absent seats, deterministic reproducible deal, next-hand vs. completion.

## 4. Authoritative intent loop (D3, D4)

- [x] 4.1 Implement room-level authority checks: reject an intent whose `seat` ≠ the connection's seat, and reject an intent from a seat other than the engine `seatToAct`, before any engine call (spec: match-intent-loop).
- [x] 4.2 Map a `PlayerIntent` to the engine `Event` and apply via `reduce`; on engine rejection leave `State` unchanged and emit no other-seat broadcast.
- [x] 4.3 Implement the per-recipient broadcast: compute each connection's payload with `viewFor(state, seat)` at send time (spectators → `viewFor(state, null)`); never reuse one payload across seats.
- [x] 4.4 Implement the optimistic/authoritative protocol: per-intent correlation id, `accept` ack (correlation id + submitter's authoritative view) and `reject` ack (correlation id + machine-readable reason + corrective resync).
- [x] 4.5 Implement full filtered-view resync on join/seat entry.
- [x] 4.6 Unit-test the intent loop: legal apply+broadcast, illegal no-op, spoofed-seat reject, out-of-turn reject, per-seat distinct payloads, accept ack, reject+resync, full view on join.

## 5. Colyseus Room adapter (D1, D2)

- [x] 5.1 Define the minimal non-secret Colyseus metadata schema (lifecycle state, seat occupancy, `seatToAct`) — no card-bearing fields.
- [x] 5.2 Implement the Colyseus `Room` subclass as a thin adapter: `onCreate` (construct `RoomCore` from the variant), `onJoin`, `onMessage` (intents + contributions), `onLeave`, `onDispose`; translate `RoomCore` effects into per-connection sends.
- [x] 5.3 Replace the boot stub in `apps/match/src/index.ts` with room registration on the Colyseus `Server`, preserving the existing fail-fast env validation and db/redis client construction.
- [x] 5.4 Update `apps/match/fly.toml` and `Dockerfile` for the room server's runtime shape (no full Fly deploy hardening in this slice).

## 6. End-to-end verification

- [x] 6.1 Add an integration test that boots `RoomCore` (or the room in-process), fills the seats, runs the shuffle handshake, and plays a full hand to `HandScoring` over the intent loop, asserting no hidden info leaks into any seat's view.
- [x] 6.2 Confirm `Persisted` is an explicit inert transition (no durable write) and is commented/asserted as such.
- [x] 6.3 Run lint, typecheck, and tests via the validate agent and resolve findings.
