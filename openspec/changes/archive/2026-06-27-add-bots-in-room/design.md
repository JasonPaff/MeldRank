## Context

The Match Service (`apps/match`) is a pure `RoomCore` state machine (`(state, input) → {state, effects}`) wrapped by a thin Colyseus adapter (`MatchRoom`) that owns all IO, timers, and the only calls into the core. Through slice #4 the room handles room core, move clocks, and disconnect/reconnect/abandonment; slice #6 (unit A) added persistence + result emission. The remaining runtime piece is **slice #5: bots in the room** (Match Runtime — Design v1 §7), combined here with the v1 bot decision logic (Bots & AI — Design v1) so a Single-Deck Partners match can self-play to completion with 1 human-stub + 3 bots (Linear SLE-184, roadmap step 1).

Two facts shape the design:

1. **Nothing currently drives a non-human seat.** The core emits per-seat `view`/`accept` effects addressed to a `connectionId`; for a seat with no Colyseus client the adapter's `findClient` returns `undefined` and the send is dropped. There is no mechanism that asks a seat to _produce_ a move — humans push intents in; bots need to be pulled.
2. **Bot architecture is locked (§7 R5):** in-process inside the Match Service, behind the same intent interface as humans, never in ranked, and structured so it is _extractable_ to a separate Bot Worker later with no protocol change. The `apps/bots` deployable stays a stub; extraction is explicitly out of scope.

## Goals / Non-Goals

**Goals:**

- Seat bots as first-class seats in the pure core so a bot-filled casual room reaches `Live` and runs the per-hand loop.
- Drive a bot seat's turn from the adapter: derive its `FilteredView` → wait a humanized think delay → call the brain → resubmit the intent through the normal authoritative path.
- Ship a pure, in-process `@meldrank/bots` package with a random-legal brain behind a stable `brain(view, ctx) → PlayerIntent` interface and a difficulty seam.
- Wire the existing `botTakeoverRequested` casual-takeover hook to a real playing bot, reusing the same driver as cold-start fill.
- Keep the core pure and the rules layer bot-agnostic; keep bots out of ranked; keep hidden info unreachable to bots.

**Non-Goals:**

- Heuristic/strength play, bidding valuation, partner-awareness, difficulty tiers beyond the seam (Bots & AI §3–§5 — explicitly Next).
- Extracting bots into the `apps/bots` worker or any out-of-process transport (§7 — Next).
- Auction/double-deck bot strategy (widow/bury) — Partners-first only (Bots & AI §6).
- The API path that _requests_ bot seats (`casual.addBot`/`quickPlay`) — that is unit D; this change exposes the seating mechanism the room offers.
- Any change to ranked behavior, the wire protocol, or persistence (unit A) internals.

## Decisions

### D1 — Bots are seated in the core, not tracked beside it

A bot occupies a real `SeatAssignment` in `RoomCoreState.seats` with a synthetic `connectionId` and a bot marker, rather than living in an adapter-side registry.

- **Why:** cold-start fill must let the room reach `Live`, and `isFull()` counts `state.seats`. Seats not in the core cannot satisfy fullness, and the core's per-seat broadcast/clock/turn machinery is all seat-indexed. The takeover path already marks a seat `BotControlled` in the core, so this generalizes machinery that half-exists.
- **Marker:** prefer an explicit `isBot` boolean on `SeatAssignment` over overloading `connectionStatus`. `connectionStatus: 'BotControlled'` means "a human seat currently handed to a bot (reclaimable)"; a cold-start seat-fill bot was never human and is not reclaimable. Distinguishing "is this seat bot-driven _right now_" (drives the adapter loop) from "was this a human" (drives reclaim) keeps both paths correct. The adapter drives a seat whenever it is bot-driven, by either signal.
- **Alternative considered:** synthetic clients registered with Colyseus so `view`/`accept` effects flow normally. Rejected — it pushes fake transport objects through the adapter and couples bot presence to Colyseus internals; the pull-driver is simpler and keeps the core the single source of seat truth.

### D2 — A new `seatBot` core entrypoint; the takeover path converges on it

Add a pure `seatBot(state, …) → JoinResult`-shaped step that seats a bot at the lowest free seat (cold-start fill) or at a specified seat (takeover), refusing when the room is ranked, disposed, or full. The casual takeover (`expireGrace` → `botTakeoverRequested`) keeps marking the seat `BotControlled`; the adapter responds by driving that seat — the two converge on one driver.

- **Why a distinct entrypoint vs. a `joinRoom` variant:** `joinRoom` assumes a real transport connection and emits a join-time `view` to that connection; a bot has no client to send to. A separate, smaller function avoids threading "is this a bot" conditionals through the human join path and keeps `joinRoom`'s contract clean.
- **Ranked guard lives in the core** (not just the adapter), so the "never seat a bot in ranked" invariant holds regardless of caller.

### D3 — The adapter is the bot runner; it pulls moves after every step

Extend `MatchRoom.run()` (which already adopts a step, emits effects, syncs metadata, re-arms the deadline timer): after those, if `engine.public.seatToAct` is a bot-driven seat, schedule the bot's move. The bot move is computed by deriving `viewFor(seat)` from the authoritative engine, calling the brain, and calling `submitIntent(core, botConnId, intent, correlationId, serverSeed, now)` — the exact path a human intent takes.

- **Re-entrancy:** a bot move calls `run()` again (via `submitIntent`'s result), which may leave another bot on the clock, naturally driving consecutive bot turns until a human is on the clock or the match completes. Guard against driving the same seat twice (one in-flight bot timer at a time) and against acting when the room is not `Live` or is resolved.
- **Why in the adapter, not the core:** producing a move requires the filtered view and a randomness/think-delay schedule — IO and timing the pure core deliberately excludes. The core stays `(state, input) → {state, effects}`; the adapter is where "ask the brain" belongs, mirroring how it already owns the move-clock and grace timers.

### D4 — Humanized think delay on the existing Colyseus clock

The adapter schedules each bot move via `this.clock.setTimeout` after a randomized bounded delay (Bots & AI §7), not synchronously inside the triggering step.

- **Why:** instant bot moves make the table unreadable and can re-enter `run()` mid-step. A scheduled delay also matches the §7 pacing requirement and reuses the timer ownership the adapter already has.
- **Bound:** a default range (e.g. ~400–1200ms) carried as adapter/config so it is tunable; kept well under the move clock so a bot never times itself out. The exact range is a tuning detail (Bots & AI §9 open item), not a spec-load-bearing value.
- **Interaction with the move clock:** the bot move clock keeps running during the think delay (no special-casing); since the delay ≪ base allotment, a normal bot move lands comfortably inside its clock.

### D5 — `@meldrank/bots`: a pure brain package

Create `packages/bots` (`@meldrank/bots`), depending only on `@meldrank/engine` and `@meldrank/shared`, exporting `brain(view, ctx) → PlayerIntent`. `ctx` carries at least the acting seat and a difficulty selector plus an injected randomness source (for purity/testability). The v1 brain enumerates engine-legal moves _from the filtered view_ (the same legality the optimistic client runs) and picks one uniformly.

- **Why a package, not inline or in `apps/bots`:** the §7 "extractable later" promise is cleanest when the brain is already an independent, dependency-light unit — a future Bot Worker just wraps the same package. Inlining in `apps/match` would have to be carved back out later; importing from `apps/bots` (an app) into `apps/match` (an app) creates an app→app dependency the monorepo graph should not have.
- **Legality source:** the engine is the single rules authority and already runs in three places including bots. The brain calls the engine's legal-move enumeration over the filtered view; it never re-implements legality. Meld is engine-computed — no bot decision.
- **Difficulty seam:** present but inert in v1 (uniform random). It exists so a heuristic policy (Next) drops in behind the same signature.

### D6 — Determinism & fair play fall out of existing seams

- **Replay:** the room logs the bot's _emitted intents_ (capability `match-persistence`), so replay reconstructs bot moves from the log regardless of the brain's RNG — no need to reproduce bot internals.
- **Fair deal:** bot seats need no special-casing in the shuffle handshake; per Bots & AI §7 / Anti-Cheat §2 a bot seat contributes server-generated entropy committed identically to a human. For the skeleton, an un-contributing bot seat already falls through the handshake's deterministic missing-contribution fallback (capability `match-shuffle-handshake`), so no handshake change is required in this change.
- **Hidden info:** the brain is handed only `viewFor(seat)`, so it is structurally as informed as a human — no extra enforcement needed.

## Risks / Trade-offs

- **Re-entrant driving could recurse or double-fire** (a bot move re-enters `run()` which schedules another bot move). → Single in-flight bot timer; clear/guard it like the deadline timer; only ever drive the one seat on the clock, and only while `Live` and unresolved.
- **A bot whose intent the room rejects would stall the table.** → The random-legal brain selects only from engine-legal moves, so a correct brain never produces a rejected intent; defensively, a rejected bot intent should surface loudly (it indicates a brain/legality bug) rather than silently retry forever. Covered by the spec's "intent always legal" requirement and adapter-level logging.
- **Think delay vs. move clock interaction.** → Delay bounded well under the base allotment; the bot clock running during "thinking" is intentional and harmless at these magnitudes.
- **`BotControlled` vs `isBot` ambiguity** (reclaimable takeover vs. permanent fill). → Two explicit signals (D1): drive on "bot-driven now," reclaim on "was a human." Keeps takeover reclaim and seat-fill non-reclaim both correct.
- **Scope creep toward heuristics.** → v1 is strictly random-legal behind the difficulty seam; strength play is Next and gated by the seam so it lands without touching the room.
- **Cross-package import direction.** → Brain lives in `packages/bots` (a package), imported by `apps/match`; no app→app dependency, consistent with the locked monorepo layout.
