## Context

Match Runtime slice #2 (`match-room-core`) established the authoritative room as **pure functions over an immutable `RoomCoreState`** (`apps/match/src/room/core.ts`), returning `{ state, effects }` with a thin Colyseus `MatchRoom` adapter (`apps/match/src/colyseus/matchRoom.ts`) translating effects into `client.send(...)`. The core deliberately touches no socket, clock, or database; its only nondeterminism is the injected `ServerSeedSource = () => Uint8Array` seam (`room/types.ts:77`).

The room is currently **timeless**, which slice #2 flagged as two explicit gaps:

1. A seat to act can hold the turn forever — there is no per-move bound.
2. The provably-fair contribution window only closes when _every_ seat happens to contribute (`core.ts:156`, "no clock yet, design D5"); an absent seat blocks the deal indefinitely.

The engine side of timeouts already exists and is tested: `TimeoutMove(state): PlayerIntent | null` (`packages/engine/src/timeout/timeout.ts`) and its integration into `reduce` via the `timeout` `SystemEvent` (`packages/engine/src/state/reduce.ts:68`). What is missing is the runtime that _decides when_ a seat has run out of time and injects that event. This slice (Match Runtime — Design v1 §5) supplies exactly that, plus the clock state clients render.

## Goals / Non-Goals

**Goals:**

- Server-authoritative per-move clocks: fresh base allotment each turn + non-refilling reserve bank, defaults 20s / 90s, config-driven.
- Keep `RoomCore` pure and deterministic — inject time through a `Clock` seam mirroring `ServerSeedSource`; the wall-clock timer lives only in the adapter.
- Resolve expiry by reusing the engine's `timeout` → `TimeoutMove` path; no forced-move logic in `apps/match`.
- Close the deferred contribution-window seam with a deadline.
- Emit a repeated-timeout abandonment signal for slice #4 to consume.

**Non-Goals:**

- Acting on abandonment (forfeit, bot takeover, reconnection grace) — that is slice #4. This slice only emits the signal.
- Differentiating ranked vs casual clock _values_ — both use one default for now (decision: shared 20s/90s); only the config seam is built so they can diverge later.
- Persisting clock history or timeout counts to Postgres — slice #6.
- Any change to `packages/engine`. The engine's `timeout`/`TimeoutMove` machinery is reused as-is.

## Decisions

### D1 — Time enters the pure core through an injected `Clock` seam, not a wall clock

`RoomCore` stays deterministic by taking the current time as an explicit input, exactly as it already takes `ServerSeedSource`. A `Clock = () => number` (monotonic milliseconds) is threaded into the step functions that need "now" (`submitIntent`, `submitContribution`, the new expiry step, `beginHand`). All deadline arithmetic is pure given that number, so tests inject a deterministic clock and reproduce every expiry.

_Alternatives considered:_ storing wall-clock `Date.now()` inside the core (rejected — breaks the established purity/testability contract and resume-determinism); a Colyseus-managed `setSimulationInterval` ticking the core (rejected — pushes timing concerns into the core and couples it to Colyseus). The injected-seam choice keeps the exact pattern slice #2 already proved.

### D2 — Clock state is data on `RoomCoreState`; deadlines are computed, not stored as timers

Each seat carries `{ remainingBaseMs, remainingReserveMs }`; the _turn_ carries `turnStartedAt` (the injected time the current seat began acting). A seat's expiry is `turnStartedAt + remainingBase + remainingReserve` — derived, never a live timer. On each accepted move, the room charges `elapsed = now - turnStartedAt` against the acting seat's base first, then reserve, and stamps `turnStartedAt = now` with a fresh base for the next seat. This makes charging a pure function of two timestamps and keeps state serializable.

### D3 — The adapter owns the single pending wall-clock timer

`MatchRoom` keeps one pending timer for the current seat's deadline. On every step result it: reads the new acting seat's deadline from the returned state, clears the prior timer, and schedules a new one (`this.clock.setTimeout`, Colyseus's deterministic timer). When it fires, the adapter calls a new `expireClock(state, now)` core step. An accepted move arriving first cancels-and-reschedules. The core emits no timers and knows nothing about `setTimeout`; the adapter holds no game logic. This mirrors the existing `run(step)` effect-drain in `matchRoom.ts:90`.

_Alternative:_ per-seat timers (rejected — only one seat is ever on the clock; a single timer is simpler and matches the engine's single `seatToAct`).

### D4 — Expiry is a new core step that injects the engine `timeout` event

`expireClock(state, now)` zeroes the acting seat's remaining base+reserve, then builds the engine `TimeoutEvent { type: 'timeout', seat }` and feeds it to `reduce` — the same `reduce` that `submitIntent` calls. `reduce` internally calls `TimeoutMove` and re-enters with the forced intent (`reduce.ts:68`). From there the existing advance + per-recipient broadcast logic runs unchanged. This is the crux of "reuse the engine policy": `apps/match` never decides _what_ the forced move is, only _that_ time ran out.

Note: `submitIntent` today only accepts `PlayerIntent`. The timeout event is a `SystemEvent`, so `expireClock` calls `reduce(engine, timeoutEvent)` directly rather than going through `submitIntent`'s player-authority guards (which would wrongly reject a system event). The post-`reduce` advance/broadcast tail is factored out and shared between the two paths.

### D5 — Contribution window closes on a deadline (closes the slice-#2 seam)

`beginHand` records a contribution deadline `now + contributionWindowMs`. `submitContribution` rejects contributions after the deadline. A new adapter timer (or the same expiry plumbing) fires a `closeContributionWindow(state, now)` step when the deadline passes, which proceeds to deal using the existing `assembleSeed` + `fallbackContribution` path for any absent seat. The "deal when all seats contributed" fast-path is retained — if everyone contributes early, the window closes immediately and we deal without waiting for the deadline. This removes the indefinite-block behavior while preserving the provably-fair guarantees from slice #1.

### D6 — Clock values are config on the room, defaulting once

`createRoomCore` gains a `ClockConfig { baseMs, reserveMs, contributionWindowMs, timeoutAbandonThreshold }` with the locked defaults (20_000 / 90_000 / a short window / a small threshold). Ranked and casual pass the same values today; the seam exists so a future change sets different profiles without touching specs or core logic.

### D7 — Abandonment is an emitted `Effect`, counted per seat

`RoomCoreState` gains a per-seat `timeoutCount`. `expireClock` increments it; when it crosses `timeoutAbandonThreshold` in a ranked room, the step appends a new `Effect` kind (`abandonmentSignal`, addressed/identified by seat) to its result. The adapter forwards it (initially as a logged/published event; slice #4 wires the real consumer). No state beyond the count and the emitted effect changes — this slice does not forfeit or substitute.

## Risks / Trade-offs

- **Wall-clock drift / timer imprecision in the adapter** → The core deadline is authoritative; the adapter timer only needs to fire _at or after_ the deadline. When it fires, `expireClock` recomputes against the injected `now`, so a slightly-late timer still charges the correct elapsed time. A slightly-early fire is guarded by re-checking the deadline in the step and rescheduling if not yet expired.
- **Clock charged for server-side processing latency** → Charging `now - turnStartedAt` includes network/processing time, marginally disadvantaging the player. Acceptable at this scale; reserve bank (90s) absorbs noise. Revisit if it proves material.
- **Reconnection interaction is unspecified here** → A disconnected seat keeps burning its clock and will time out, which is the intended pre-#4 behavior (it degrades to forced moves, not a frozen table). Slice #4 layers grace windows on top; nothing here blocks that.
- **System-event path bypasses player guards** → Factoring the post-`reduce` tail out of `submitIntent` risks divergence between the player and timeout paths. Mitigation: extract a single shared `applyAdvanceBroadcast` helper used by both, covered by tests asserting identical broadcast behavior.
- **Contribution-window timer adds a second adapter timer** → Two timer kinds (turn deadline, contribution deadline) but they are never both pending for the same seat-to-act phase; keep them as one "pending deadline" slot keyed by what the room is currently waiting on.

## Migration Plan

Additive within `apps/match`; no schema or API changes, no engine changes, no new dependencies. Deploys with the Match Service. Rollback is reverting the slice — the room returns to its timeless slice-#2 behavior with no data migration. Clock fields are new on in-memory `RoomCoreState` only (rooms are ephemeral), so there is no persisted-state compatibility concern.

## Open Questions

- Exact `contributionWindowMs` and `timeoutAbandonThreshold` defaults — pick concrete values during apply (proposed: short contribution window ~10s; abandon threshold ~2–3 consecutive ranked timeouts). Not spec-level; tunable config.
- Whether the per-seat clock state broadcast should include _every_ seat's remaining time or only the acting seat's — spec requires at minimum the acting seat; broadcasting all seats' banks is cheap and likely desirable for the table UI. Decide during apply.
- Should casual rooms count timeouts at all (no abandonment action there)? Default: count but never emit the signal in casual. Confirm during apply.
