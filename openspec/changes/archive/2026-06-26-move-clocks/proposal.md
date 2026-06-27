## Why

Match Runtime slice #2 (`match-room-core`) stood up the authoritative room and the validate→apply→advance→broadcast intent loop, but deliberately left the room **timeless**: a seat can sit on the clock forever, and the provably-fair contribution window only closes when every seat happens to contribute. Competitive pinochle needs bounded turns — without server-authoritative move clocks a single idle or stalling player freezes the table indefinitely. This slice (Match Runtime — Design v1 §5) adds the clock, wires it to the engine's already-implemented `timeout-move` forced-move policy, and emits the abandonment signal that slice #4 consumes.

## What Changes

- Introduce **server-authoritative move clocks** in `apps/match`: each turn the acting seat gets a fresh per-move **base allotment**, backed by a **non-refilling per-player reserve bank** that is only drawn down once the base for a turn is exhausted.
- **Default values (both modes): 20s base + 90s reserve.** Values are config-driven (carried on match/room config, not hard-coded) so ranked and casual can diverge later without a spec change.
- On clock exhaustion, the room injects the engine's `timeout` system event for the acting seat, which `reduce` resolves via the existing **`TimeoutMove`** policy (auto-pass in Auction, auto-play lowest-value legal card in TrickPlay) and re-enters the same intent loop and broadcast path.
- Keep the pure `RoomCore` deterministic by injecting time through a **`Clock`/now seam** (the same injected-seam pattern as the existing `ServerSeedSource`); the Colyseus `MatchRoom` adapter owns the real wall-clock timer that fires the deadline.
- Each accepted move **resets** the next seat's base allotment and persists the acting seat's remaining reserve; the room broadcasts each seat's clock state (remaining base + reserve, deadline) alongside its filtered view.
- **Close the deferred contribution-window seam from slice #2:** the provably-fair contribution window now closes on a deadline — seats that miss it fall back to the deterministic missing-contribution path rather than blocking the deal forever.
- Emit an **abandonment hook** (a new room effect/signal) when a seat accrues repeated timeouts past a threshold in ranked, for the separate disconnect/reconnect/abandonment slice (#4) to consume. This slice only emits the signal; it does not act on it.

## Capabilities

### New Capabilities

- `match-move-clocks`: per-move base allotment + non-refilling reserve bank, the injected clock seam, server-authoritative deadline arithmetic in pure `RoomCore`, the wall-clock timer in the Colyseus adapter, timeout→forced-move resolution, per-seat clock-state broadcast, and the repeated-timeout abandonment signal.

### Modified Capabilities

- `match-intent-loop`: each accepted intent now charges/resets clocks for the relevant seats, and a clock-expiry path injects the engine `timeout` event through the same validate→apply→advance→broadcast loop.
- `match-shuffle-handshake`: the contribution window now closes on a deadline instead of waiting for all seats indefinitely; missed contributions resolve via the existing deterministic fallback.

## Impact

- **apps/match** (`src/room/`): new `clock.ts` (pure deadline/charge logic + `Clock` seam type), changes to `core.ts` (`submitIntent`, `submitContribution`, `beginHand`) and `types.ts` (clock fields on `RoomCoreState`/`SeatAssignment`, new `Effect` kinds for clock-state and abandonment signal).
- **apps/match** (`src/colyseus/`): `matchRoom.ts` gains a per-room wall-clock timer (Colyseus simulation interval / timeout) that translates real elapsed time into the injected `now` and fires expiry steps; `schema.ts` `RoomMetadata` may surface the on-clock deadline.
- **packages/engine**: no engine change — reuses the existing `timeout` `SystemEvent`, `reduce` integration, and `TimeoutMove` policy (`packages/engine/src/timeout/`). Consumed, not modified.
- **Config**: clock values added to room/match config (carried into `createRoomCore`); ranked vs casual share one default for now.
- **Downstream**: emits the abandonment signal consumed by slice #4; no persistence yet (slice #6).
- **No new runtime dependencies.**
