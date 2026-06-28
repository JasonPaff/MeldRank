## Why

The engine→room→persistence spine is complete and tested, but a match cannot finish without four actors and there is no non-human one. The MVP walking skeleton (Linear SLE-184, step 1) needs a full Single-Deck Partners match to play to completion with **1 human-stub + 3 bots** so the spine can be watched end-to-end and its result persisted. This is the last runtime piece (Match Runtime slice #5) before the API/contract layer.

## What Changes

- **Seat in-process bots in the room** behind the same intent interface as humans. A bot occupies a real seat in the pure `RoomCore` (synthetic connection id + a bot marker), so a bot-filled room reaches `Live` and counts toward `isFull()` exactly like a human-filled one. Supports cold-start seat-fill and casual disconnect-takeover.
- **Add a bot driver loop in the Colyseus adapter.** After each `RoomCore` step, when the acting seat is a bot the adapter derives that seat's `FilteredView`, waits a short randomized "think" delay (Bots & AI §7 humanized pacing, on the adapter's existing clock), invokes the bot brain, and feeds the returned `PlayerIntent` back through `submitIntent` on the bot's synthetic connection.
- **Wire the existing `botTakeoverRequested` hook to actually seat a playing bot** in casual rooms, replacing the inert log-only stub. The returning human can still reclaim the seat (reconnection path is unchanged).
- **Introduce `packages/bots`** — a pure, in-process decision-logic package (`@meldrank/bots`) exposing the bot brain behind a stable `brain(view, ctx) → PlayerIntent` interface. v1 ships a **random-legal** brain: enumerate the legal moves the engine permits _over the filtered view_ and pick one. This is the same code a future extracted Bot Worker would wrap (Match Runtime §7 R5 — extractable later, no protocol change).
- Bots decide **only from the per-seat filtered view** (no hidden-information access, by construction) and are **never seated in ranked rooms**.
- `apps/bots` (the deployable worker) stays a boot stub; extraction to a separate worker is explicitly out of scope (a later step).

## Capabilities

### New Capabilities

- `bot-seating`: in-process bot seats in the Match Service room — the pure-core seat-a-bot path (synthetic connection + bot marker, counts toward fullness, never in ranked), the Colyseus adapter's bot driver loop (derive filtered view → think-delay → brain → resubmit intent), and the casual disconnect-takeover wiring. Slice #5 of the Match Runtime plan.
- `bot-decision-policy`: the bot brain in `packages/bots` — the `brain(view, ctx) → PlayerIntent` intent-interface contract and the v1 random-legal decision logic that chooses among engine-legal moves derived from the filtered view, with a difficulty seam for later heuristic tiers.

### Modified Capabilities

- `match-disconnect-abandonment`: the casual `BotControlled` takeover now seats a playing bot that acts on the seat's behalf, superseding the prior requirement that a `BotControlled` seat only runs its move clock with "no bot acts yet."

## Impact

- **New package:** `packages/bots` (`@meldrank/bots`) — pure decision logic, depends on `@meldrank/engine` and `@meldrank/shared`; zero IO. Consumed in-process by `apps/match`.
- **`apps/match/src/room` (pure core):** new seat-a-bot path and a bot marker on `SeatAssignment`; bots counted in seat-fill/`isFull`. The `(state, input) → {state, effects}` purity and the rules layer are unchanged (the core does not distinguish bot seats at the legality boundary).
- **`apps/match/src/colyseus/matchRoom.ts` (adapter):** the bot driver loop and think-delay scheduling on the existing Colyseus clock; `onBotTakeoverRequested` seats a real bot.
- **Design source of truth:** Match Runtime §7 (R5, in-process/intent-interface, never-ranked), Bots & AI — Design v1 (random-legal v1, difficulty seam, humanized pacing, fair-play stance), Match Runtime §6.2 (casual bot takeover).
- **Unchanged:** `apps/bots` worker (stays a stub); the wire protocol; ranked behavior; persistence (unit A) consumes the same `Complete`/`persist` path regardless of who occupied the seats.
- **No new external dependencies** beyond the new internal workspace package.
