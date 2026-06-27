## Why

The Match room (`apps/match`) keeps a live table alive while everyone stays connected, but a disconnect mid-`Live` is currently a no-op: `leaveRoom` only frees pre-`Live` seats, and the repeated-timeout `abandonmentSignal` is emitted but never acted on. Without disconnect detection, a reconnection grace window, and an authoritative abandonment resolution, a dropped player either strands the table forever or — worse for ranked integrity — lets a rage-quitter escape a loss. This is Match Runtime slice #4 (Design v1 §6, §10), the anti-abuse keystone that makes quitting never the rational move while protecting the genuinely-unlucky via the grace window.

## What Changes

- **Disconnect detection + grace window.** A `Live` seat that drops is marked `Disconnected` and a server-authoritative reconnection grace timer starts (default 90s, carried on room config), independent of the move clock. Both timers run for a disconnected seat whose turn it is; whichever fires first resolves.
- **Reconnection resync.** A seat that returns within grace is restored and pushed a full authoritative filtered-state resync (its `viewFor` view + current clock state), keyed by the stubbed seat `token` so a new transport session reclaims the same seat.
- **Ranked grace-then-forfeit resolution.** On grace expiry (or a ranked repeated-timeout abandonment signal) the match resolves authoritatively with per-seat outcomes: abandoner full loss, any partner of the abandoner a protected/reduced loss, opponents a normal win — never softer than playing it out. The room emits the resolution and an abandon event for the separate leaver-penalty layer (thresholds owned by Anti-Cheat & Moderation — this slice only fires the hook).
- **Crash / multi-drop abort.** When two or more ranked seats are past grace simultaneously (no legitimate result is possible), the match aborts with no rating change rather than manufacturing a winner. A lost room (process/room crash) aborts by absence of a persisted record — no seat is penalized.
- **Resolution reasons on the room.** The room carries a terminal resolution (`forfeit_abandon | timeout_abandon | aborted`) into its `Complete → Persisted` run-out, replay-ready for slice #6's persistence + result emission (which this slice does not implement).
- **Casual bot-takeover (stubbed seating).** On casual grace expiry the seat is marked bot-controlled and a takeover request is emitted, reclaimable by the returning human before match end. The bot _decision_ logic (slice #5, `apps/bots`) is not built, so the seating contract is stubbed behind the same intent interface — mirroring how `match-room-core` stubbed Clerk seat identity.

## Capabilities

### New Capabilities

- `match-disconnect-abandonment`: disconnect detection and the reconnection grace window; full filtered-state resync on return; ranked grace-then-forfeit resolution with per-seat outcomes; crash/multi-drop abort with no rating change; the leaver-penalty abandon-event hook; and the stubbed casual bot-takeover seating contract.

### Modified Capabilities

- `match-room-lifecycle`: a mid-`Live` connection drop is no longer a no-op — it drives disconnect/grace handling, and the room can reach its terminal `Complete` via a forfeit or abort resolution (carrying a resolution reason) rather than only when the engine reports the match complete. The "abandonment handling out of scope" disclaimer in room disposal is removed.
- `match-move-clocks`: the ranked repeated-timeout abandonment signal — previously emit-only — now additionally drives the `match-disconnect-abandonment` forfeit resolution (reason `timeout_abandon`).

## Impact

- **Code:** `apps/match/src/room/` — new connection-status/grace model and resolution functions in `core.ts`/`types.ts` (extend `SeatAssignment`, `RoomCoreState`, `ClockConfig`, `Effect`, `pendingDeadline`); `leaveRoom`/`expireClock` gain real behavior; new `reconnect`, `expireGrace`, `resolveAbandonment`, `abortMatch` core steps. The Colyseus adapter (`colyseus/matchRoom.ts`) wires `onLeave` → grace via `allowReconnection`, reconnection-token resync, the multi-deadline timer, and forwards abandon/takeover/resolution effects.
- **Specs:** one new spec, two delta specs (above).
- **Dependencies:** none new (Colyseus reconnection is built in). Stubs/hooks point at slice #5 (bots) and slice #6 (persistence/result emission) and the Anti-Cheat & Moderation leaver-penalty layer; ranked is Single-Deck Partners only in v1.
- **Out of scope:** real persistence/result emission (#6), real bot decisions (#5), leaver-penalty thresholds (Anti-Cheat doc), Clerk-backed identity/reconnection tokens (Auth doc — token stays stubbed), crash-recovery state snapshots (Next-phase hardening).
