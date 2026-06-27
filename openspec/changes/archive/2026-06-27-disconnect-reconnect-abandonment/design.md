## Context

`apps/match` already runs the live table as a pure `RoomCore` (`src/room/core.ts`) returning `{ state, effects }`, with the Colyseus `MatchRoom` adapter (`src/colyseus/matchRoom.ts`) translating effects into sends and owning a single wall-clock timer driven by `pendingDeadline`. Slice #2 stubbed disconnect handling: `leaveRoom` is a no-op once `Live`, and seat identity is a stubbed `token` on `SeatAssignment`. Slice #3 added the injected `Clock` seam, per-seat clock banks, and an emit-only `abandonmentSignal` on repeated timeouts.

This slice (Match Runtime Design v1 §6, §10) fills the gap: detect a `Live` disconnect, run a grace window, resync a returning seat, and resolve abandonment authoritatively — ranked forfeit (§6.3), casual bot-takeover stub (§6.2), multi-drop/crash abort (§10). It reuses every existing seam (`Clock`, `Effect`, `pendingDeadline`, the per-recipient broadcast helpers); no new dependency. Ranked is Single-Deck Partners only in v1.

## Goals / Non-Goals

**Goals:**

- Disconnect detection + a server-authoritative grace window deadline, deterministic under the injected clock.
- Full filtered-state resync on reconnect, keyed by the stubbed seat `token` (survives a new transport session).
- Ranked grace-then-forfeit and ranked timeout-abandon resolution with per-seat outcomes; multi-drop/crash abort; abandon-event hook for the leaver-penalty layer.
- Keep all decision logic in the pure `RoomCore`; the adapter only wires Colyseus reconnection + timers.
- Casual bot-takeover **seating contract** stubbed behind the human intent interface.

**Non-Goals:**

- Real persistence / result-emission payload (slice #6 — `Persisted` stays inert; resolution is carried on state, not written).
- Real bot move generation (slice #5 — only the takeover seating request is emitted).
- Leaver-penalty thresholds / cooldowns (Anti-Cheat & Moderation doc — only the hook is fired).
- Clerk-backed identity & real reconnection tokens (Auth doc — `token` stays stubbed).
- Crash-recovery state snapshots (Next-phase hardening — a crashed room aborts by absence of a persisted result).

## Decisions

**D1 — Connection status on the seat, not a parallel map.** Extend `SeatAssignment` with `connectionStatus: 'Connected' | 'Disconnected' | 'BotControlled'`, a `graceDeadline: number | null`, and reuse the existing stable `token`. Keeping it on the seat means the existing seat-indexed helpers and broadcasts already carry it. _Alternative — a separate disconnect registry:_ rejected; it would duplicate seat lifetime and risk drift from `seats`.

**D2 — Grace is a deadline, parallel to the move clock; the adapter still owns one timer.** The core stamps `graceDeadline = now + config.reconnectGraceMs` on disconnect and never reads a wall clock. `pendingDeadline` becomes the **earliest** of `{contribution close, acting-seat turn expiry, every disconnected seat's grace deadline}`, returning a discriminated `kind: 'turn' | 'contribution' | 'grace'` (grace carries its `seat`). The adapter's existing single-timer reschedule loop is unchanged in shape: on fire it dispatches by `kind` to `expireClock` / `closeContributionWindow` / new `expireGrace`, each of which re-guards its own deadline so a slightly-early fire just reschedules (the established pattern). This naturally implements §6.1 "wait out the shorter of (grace, move clock)" — both deadlines are candidates and the earliest wins, with no special-casing. _Alternative — a second dedicated timer for grace:_ rejected; multiplexing one timer over the minimum deadline is already the codebase's idiom and avoids timer bookkeeping.

**D3 — `reconnectGraceMs` on `ClockConfig`, default 90_000.** The §6.1 open item (60–120s) is decided here at **90s**, carried on `ClockConfig` next to `baseMs`/`reserveMs` so ranked vs casual can diverge without a spec change — consistent with how slice #3 parameterized clock values. _Alternative — a hard-coded constant:_ rejected for the same divergence reason that drove D6 in slice #3.

**D4 — Reconnect keyed by `token`, returning a new connection id.** Colyseus `allowReconnection(client, seconds)` in `onLeave` yields a reconnected `Client` (a fresh `sessionId`). The adapter calls `reconnect(core, token, newConnectionId, now)`; the core finds the seat by `token`, rewrites its `connectionId`, clears `graceDeadline`, sets `Connected`, and emits a `view` + `clockState` resync to the new connection (reusing `safeView`). Engine `State` is untouched. The stubbed `token` is the join-time identity; real Clerk reconnection tokens are deferred. _Alternative — key by `connectionId`:_ impossible, the id changes across the drop.

**D5 — A single `resolveAbandonment` tail feeds both forfeit triggers.** Two events lead to a ranked forfeit — grace expiry (`expireGrace`) and the repeated-timeout signal (`expireClock` crossing the threshold). Both call one pure `resolveForfeit(state, abandonerSeat, reason)` that computes per-seat outcomes from the variant's partnership structure and runs the room out through `Complete → Persisted` (reusing `completeAndPersist`), emitting an `abandonResolution` effect (reason + outcomes) and an `abandonEvent` effect (hook). Centralizing keeps `forfeit_abandon` and `timeout_abandon` identical except for the reason string. Per-seat outcomes are **labels** (`abandoner_loss | stranded_partner_reduced_loss | opponent_win | no_result`), not rating numbers — the rating math is slice #6/Rating's, so this slice has no Rating dependency.

**D6 — Partnership lookup from the Variant Definition.** Stranded-partner detection reads the variant's seating/partnership structure (Single-Deck Partners pairs seats; Cutthroat has none, so there is no stranded partner and every non-abandoner is an opponent). A small helper resolves `partnerOf(variant, seat)`; ranked v1 only exercises the Partners path.

**D7 — Multi-drop/crash → `abortMatch`, no abandon event.** When `expireGrace` fires while another seat is already past its grace unresolved (no legitimate single-forfeit result), the core calls `abortMatch(state, reason: 'aborted')`: every seat outcome `no_result`, run-out to terminal, an `abandonResolution` with reason `aborted`, and **no** `abandonEvent` (nobody is charged). A true process crash loses the in-memory room; with persistence deferred to #6 this already yields no rating change, so the explicit abort path covers only the in-room multi-drop case; the crash case is a documented no-op by absence of a write.

**D8 — Casual takeover is a stubbed seating effect.** On casual `expireGrace`, the seat goes `BotControlled`, the match is _not_ resolved, and the core emits a `botTakeoverRequested` effect. The adapter currently logs it (exactly like the slice-#3 `abandonmentSignal` stub `onAbandonmentSignal`); slice #5 replaces the consumer with a real bot worker joining behind the intent interface. A returning human reclaims via the same `reconnect` path, which restores `Connected`. Because no bot actually acts yet, a `BotControlled` seat still runs its move clock and forced-move path — acceptable for a stub and explicitly noted.

**D9 — Resolution is carried, not persisted.** `RoomCoreState` gains `resolution: { reason; outcomes } | null`. It is set by the resolution functions and read by a future persistence slice; `completeAndPersist` stays inert. This keeps the replay-sufficient result shaped now (near-free, per Design §9) without pulling slice #6 forward.

## Risks / Trade-offs

- **A `BotControlled` casual seat does not actually play (bots are slice #5).** → Documented stub; the seat's move clock + forced-move policy still advance the hand, so the table is not hard-stuck, and the takeover request is emitted for #5 to consume. No ranked impact (bots never seated in ranked).
- **Multi-drop "no legitimate result" rule could mis-resolve a single forfeit as an abort (or vice-versa).** → The rule is purely "≥2 seats past grace unresolved → abort, else forfeit"; both branches are exercised by deterministic tests with an injected clock so the boundary is pinned.
- **Three concurrent deadlines multiplexed onto one adapter timer.** → Each core entrypoint re-guards its own deadline and the adapter recomputes `pendingDeadline` after every step (existing pattern); an early/late fire reschedules rather than mis-resolving.
- **Stubbed `token` reconnection is weaker than real auth.** → Acceptable for this slice; Clerk reconnection tokens are an Auth-doc dependency already flagged as deferred. The seam (`reconnect(core, token, …)`) is shaped so wiring real tokens later is a swap, not a redesign.
- **Resolution carried but not persisted means a crash between resolve and dispose loses the result.** → Matches the §10 v1 baseline (server faults never cost rating); crash-recovery snapshots are explicitly Next-phase.

## Migration Plan

Additive within `apps/match`; no schema or external change. Land core model + functions with exhaustive Vitest coverage (pure, injected clock), then wire the adapter (`onLeave` → grace via `allowReconnection`, reconnection resync, the extended timer dispatch, and forwarding the new effects). No rollback concern beyond reverting the slice; the room degrades to the prior "Live drop is a no-op" behavior if reverted.

## Open Questions

- Casual vs ranked grace divergence — both default to 90s now; whether casual should be longer is a tuning question deferred to playtest (config already supports it).
- Exact `BotControlled` behavior before slice #5 lands — current stub lets the move clock drive forced moves; if that proves to stall casual tables in practice, slice #5 supersedes it.
