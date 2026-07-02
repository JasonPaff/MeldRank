# Audit: apps/match

## Summary

**Grade: C+.** The architecture is genuinely excellent — a pure, effect-returning `RoomCore` with injected clock/entropy seams, a thin Colyseus adapter, and near-exhaustive unit coverage of the core loop. But the app has one critical hole exactly where a realtime game server cannot afford one: client messages are passed to the core and the engine with **zero runtime validation**, and because the engine `reduce` accepts its full `Event` union, a client can inject the `deal` system event with a seed of its choosing — a complete bypass of the provably-fair shuffle handshake. Persistence retry is non-idempotent (duplicate match rows possible), spawned rooms leak forever if the ticketed human never joins, and two acting phases (`DeclareTrump`/`Bury`) have no move clock at all for humans, allowing indefinite stalls. All fixes are localized; none require re-architecting.

## Current architecture

- `src/room/` — the pure core: `core.ts` (lifecycle + validate→apply→advance→broadcast intent loop, handshake orchestration, abandonment resolution, match-record assembly), `types.ts` (all value types + `Effect` union), `clock.ts` (move-clock arithmetic), `lifecycle.ts` (state machine `Reserved→Filling→Live→Complete→Persisted→Disposed`), `seating.ts` (seat helpers, bot-driving predicates), `handshake.ts` + `deal.ts` (commit/contribute/deal), `index.ts` (barrel).
- `src/colyseus/matchRoom.ts` — the adapter: wires `onAuth`/`onJoin`/`onMessage`/`onLeave`/`onDispose` to core functions, translates `Effect`s into `client.send`, owns two timers (single pending-deadline timer, single bot "think" timer), drives bots through the same `submitIntent` path as humans, and performs the persist+publish IO with bounded retry.
- `src/colyseus/schema.ts` — minimal non-secret synced presence metadata (no card data ever in schema; per-seat `viewFor` messages carry hidden state). Correct design.
- `src/gateway/spawn.ts` — internal `POST /internal/rooms` route, secret-gated, zod-validated (`RoomSpawnRequestSchema`), pure decision function + thin Node-http shell.
- `src/persistence/writer.ts` — single `db.batch` transactional write (matches/hands/lines/replay) + Redis result-event publish.
- `src/index.ts` — boot: env validation via shared `loadMatchEnv`, client construction, room definition injection.

Data flow: API → spawn gateway → `matchMaker.createRoom` → room seats bots at create → human joins with HMAC seat ticket (`onAuth`) → per-hand commit/contribute/deal handshake → intents through `submitIntent` → on `MatchComplete`, `persist` effect → writer → `markPersisted` → disconnect/dispose.

## Strengths

- **Pure-core/thin-adapter split is real, not aspirational.** No game logic in the Colyseus room; every decision is a pure function returning `{ state, effects }`. Clock and entropy are injected seams (`types.ts:90`, `types.ts:355`), making the integrity-critical loop deterministic and fully unit-tested.
- **Room-level authorization is correct**: seat-spoof check (`core.ts:505-507`), out-of-turn check (`core.ts:512-514`), engine as sole legality authority (`core.ts:517`).
- **Auth gate fails closed**: `onAuth` rejects on missing secret, missing/tampered/expired ticket, or room mismatch (`matchRoom.ts:229-243`); ticket HMAC verify is constant-time (`packages/shared/src/server/api/ticket.ts:40-49`).
- **No hidden information leaks**: schema is presence-only (`schema.ts:25-31`), all card-bearing payloads are per-recipient `viewFor` projections; server seed never leaves the server until the replay blob.
- **Timer lifecycle is clean**: single deadline timer and single bot timer, both cleared-and-rearmed after every step and cleared on dispose (`matchRoom.ts:288-294`, `325-340`, `382-398`). No interval leaks found.
- **Persistence write is transactional** (one `db.batch`, `writer.ts:35-73`) and the spawn gateway validates its body with zod and fails closed on the secret.

## Findings

### [SEVERITY: High] Client can inject engine system events through the `intent` message — provably-fair shuffle bypass

- `matchRoom.ts:192-194` passes `message.intent` (an unvalidated client payload) to `submitIntent`, which passes it to engine `reduce` (`core.ts:517`). The engine's `reduce` accepts its full `Event` union, not just player intents: `packages/engine/src/state/reduce.ts:68-74` handles `{ type: 'timeout' }` in any phase and `{ type: 'deal', seed }` in the `Dealing` phase.
- During every contribution window the engine rests at phase `Dealing` with `seatToAct: null` (`state.ts:157-159`), so the turn-authority guard defers to the engine (`core.ts:512`). A client sending `{ intent: { type: 'deal', seed: <chosen>, seat: <ownSeat> }, correlationId: 'x' }` passes the seat check (`core.ts:506` only compares `intent.seat`), and `reduce` **deals the hand from the attacker's 32-bit seed** — the deal is deterministic from that seed, so the attacker knows every hand at the table, and the commit/contribute handshake is silently bypassed (handshake context is left dangling, but the game proceeds). `{ type: 'timeout', seat: <ownSeat> }` similarly lets a seat take its forced move without incurring a room-level timeout tally.
- `packages/shared/src/intent/index.ts:3-5` explicitly says "the Zod validation of these messages belongs to the Match Service" — and the match service never does it.
- **Fix (small, urgent):** add a zod `PlayerIntentSchema` (discriminated union over the five kinds in `packages/shared/src/intent/types.ts`) and parse every `intent` message at the adapter before calling `submitIntent`; additionally whitelist `intent.type` inside `submitIntent` (defense in depth so no future caller can regress this).

### [SEVERITY: High] No runtime validation of any client message; malformed payloads throw inside handlers

- `matchRoom.ts:192-197`: `message.intent` / `message.correlationId` / `message.clientSeed` are trusted to match their TypeScript interfaces. A client sending `null`, `{}`, or a non-hex `clientSeed` throws (`message.intent` property access; `fromHex` "Throws on malformed input" — `packages/fairness/src/encoding.ts:17-18`).
- The room defines no `onUncaughtException`, so a throw inside an `onMessage` handler surfaces as an uncaught exception at the transport layer — a single hostile or buggy client can destabilize the process hosting every live match.
- Unbounded sizes: `clientSeed` and `correlationId` have no length caps; a contribution's raw bytes are stored in `state.record.reveals` and serialized into the replay blob (`core.ts:437-439`, `core.ts:803-808`), so oversized contributions bloat memory and the `bytea` row.
- **Fix:** zod-parse both message shapes (cap `clientSeed` at 64 hex chars, `correlationId` at e.g. 128 chars), wrap handlers in try/catch that logs and drops, and implement `onUncaughtException`.

### [SEVERITY: High] Non-idempotent persist retry can duplicate matches; permanent failure loses the match entirely

- `matchRoom.ts:523-540` (`persistWithRetry`) retries the pair *write → publish* as one unit. If `persistMatchRecord` succeeds but `publishMatchResult` throws (Redis blip), the next attempt calls `persistMatchRecord` again — and `writer.ts:36` generates a **fresh `randomUUID()` matchId per call**, so the same match lands in `matches`/`match_hands`/`match_replays` two or three times.
- On exhausting the 3 attempts the room logs and disposes (`matchRoom.ts:532-535`): the completed match record exists only in memory and is **permanently lost** — no outbox, no dead-letter, no disk spill.
- **Fix:** generate `matchId` once before the loop and pass it in; retry write and publish independently (a persisted-but-unpublished match should not rewrite rows); on final failure, dump the `MatchRecord` JSON to a dead-letter (log at minimum with the full record, better a `failed_matches` table or disk file) before disposing.

### [SEVERITY: High] Spawned rooms leak forever when the ticketed human never joins

- `matchRoom.ts:164` sets `autoDispose = false` (deliberately, so the empty room survives until the human's `joinById`). But nothing ever reaps a room that stays `Reserved`/`Filling`: `pendingDeadline` returns `null` unless `Live` (`core.ts:612-613`), so no timer is armed, and no fill-deadline exists anywhere in the app.
- A user who calls quickPlay and closes the tab leaks a full `MatchRoom` (engine state, timers registry, Colyseus room) per attempt, for the life of the process.
- **Fix:** arm a one-shot fill-deadline timer in `onCreate` (e.g. seat-ticket TTL + margin); if the room is not `Live` when it fires, dispose via the legal pre-live `→ Disposed` edge (`lifecycle.ts:37`).

### [SEVERITY: Medium] No move clock for humans in `DeclareTrump`/`Bury` — a player can stall the match indefinitely

- The engine leaves `seatToAct: null` in those phases (`packages/engine/src/state/reduce.ts:160`; acknowledged in `seating.ts:100-104`, which special-cases them for *bots* via `engineActingSeat`). But `pendingDeadline`'s turn candidate keys on `engine.public.seatToAct` (`core.ts:621-627`) and `expireClock` no-ops when it is null (`core.ts:558-560`), so a human contract winner in `DeclareTrump` (or `Bury` in Cutthroat) is never on any clock.
- Worse for ranked: since no timeouts accrue, the `timeoutAbandonThreshold` path never triggers either — the only escape is the opponent leaving. A ranked match can be held hostage forever by an AFK/spiteful bid winner.
- **Fix:** use `engineActingSeat(state)` (already written) instead of raw `seatToAct` in `stampTurn`/`chargeActingSeat`/`pendingDeadline`/`expireClock`, and give the engine a `TimeoutMove` for `DeclareTrump` (e.g. forced lowest-legal trump) and `Bury` (forced lowest cards) — the engine currently defines none for those phases (`packages/engine/src/state/timeout.test.ts:91-104`).

### [SEVERITY: Medium] Latent zero-delay timer busy-loop when a clock expires in a phase with no forced move

- `expireClock` on a no-forced-move phase zeroes the seat's banks but leaves `turnStartedAt` set (`core.ts:589-594`). `pendingDeadline` then computes `deadline = turnStartedAt + 0 + 0` — already past — so `reschedule` (`matchRoom.ts:389`) arms a 0 ms timer, which fires `expireClock` again, forever: a hot loop in a casual room, and in a ranked room three instant iterations that forfeit the seat in ~0 ms.
- Unreachable today only because every `seatToAct !== null` phase happens to define a forced move; the fix for the previous finding (clocking `DeclareTrump` before adding its `TimeoutMove`) would make it live. Fragile invariant with no guard.
- **Fix:** when `reduce` returns the state unchanged on a timeout, also clear `turnStartedAt` (or stamp a fresh turn) so the deadline does not immediately re-fire.

### [SEVERITY: Medium] Every hand stalls the full 10 s contribution window whenever a bot is seated

- The fast-path close requires `contributions.length >= state.seatCount` (`core.ts:444`), but bot seats never contribute (nothing in the adapter contributes for a bot; the web client contributes only for its own seat, `apps/web/lib/use-table-connection.ts:174`). So in the flagship 1-human + 3-bots casual game, *every hand* waits out the entire `contributionWindowMs` (10 s, `clock.ts:21`) before dealing — ~10 s of dead air per hand.
- **Fix:** have the adapter auto-contribute CSPRNG bytes for bot-driven seats on the `commit` effect (keeps the fairness math identical), or count only connected human seats toward the fast-path close.

### [SEVERITY: Medium] Reconnection does not survive a page reload; seat-ticket `playerId` is never used

- Reclaim depends on Colyseus's in-memory reconnection token via `allowReconnection` (`matchRoom.ts:281`) plus the stub core token `seat-<n>:<sessionId>` (`seating.ts:45-47`). A page refresh loses the Colyseus token, and a fresh `joinById` with the *still-valid signed seat ticket* is rejected: while `Live`, the seat remains occupied, so `joinRoom` returns `seat-occupied`/`room-full` (`core.ts:305`, `core.ts:311`). The user watches their 90 s grace expire, then forfeits (ranked) or is bot-replaced (casual), while holding a cryptographic proof of their right to the seat.
- Related: `SeatTicket.playerId` (`packages/shared/src/api/ticket.ts:21`) is verified at `onAuth` but never stored on the `SeatAssignment` — the room has no notion of *who* sits where, so persisted matches carry no participant identity (writer comment `writer.ts:33`: `match_participants` untouched) and identity-keyed reconnection is impossible.
- **Fix:** carry `playerId` onto `SeatAssignment` at join; in `onJoin`, if the ticket's seat is occupied by the *same* `playerId` in `Disconnected`/`BotControlled` status, route to `reconnect` instead of rejecting.

### [SEVERITY: Medium] `joinRoom`/`seatBot` are a ~50-line copy-paste; invalid `desiredSeat` returns a misleading reason

- `core.ts:300-338` and `core.ts:367-406` duplicate the entire seat-selection + go-Live block (validate desired seat, lowest-free fallback, `withSeat`, lifecycle advance, `isFull` → `beginHand`). A future change to one (e.g. the fill-deadline fix) will likely miss the other — exactly the drift the file's own doc comments warn about elsewhere.
- Minor within it: an out-of-range `desiredSeat` is rejected with reason `'room-full'` (`core.ts:303`, `core.ts:370`) — wrong signal to debug from.
- **Fix:** extract a shared `selectSeat(state, desiredSeat)` and a shared `fillAndMaybeGoLive(state, ...)` tail; add an `'invalid-seat'` reject reason.

### [SEVERITY: Medium] `deal.ts` and record-assembly helpers re-implement engine internals — drift risk

- `deal.ts:36-83` re-implements the engine's `applyDeal` orchestration (`nextActivePhase` mirrors the engine's; `nextHandBase` mirrors `startNextHand`; `dealHand` mirrors `applyDeal`) for a documented reason (full-width `Rng` vs the engine's 32-bit seed). The rationale is sound but the mechanism is fragile: any change to the engine's hand-start/deal sequence (e.g. a new per-hand field to preserve, like `handsMadeAsBidder` at `deal.ts:59`) silently desynchronizes the live room from the replay/rules authority.
- `core.ts:757-763` (`sideOfSeat`) and `core.ts:819-831` (`partnerOf`) duplicate the engine's own partnership mapping ("matching the engine's own `sideOfSeat`" per its comment).
- **Fix:** extend the engine's `DealEvent` (or export a `dealWithRng(state, rng)` from the engine) so the room stops owning deal orchestration; export `sideOfSeat` from the engine and delete the copies.

### [SEVERITY: Low] Deliberate leave (`consented`) is treated identically to a network drop

- `onLeave` ignores Colyseus's `consented` flag (`matchRoom.ts:268`), so a ranked player who explicitly quits still gets the full 90 s grace before forfeiting, stalling three opponents. If intentional, document it; otherwise resolve consented ranked leaves immediately.

### [SEVERITY: Low] Boot is a module side effect; `listen` rejection unhandled

- `src/index.ts:20` boots the server at import time (`export const gameServer = createGameServer()`), with a `NODE_ENV === 'test'` branch baked into production code (`index.ts:23-28`); `void server.listen(port)` (`index.ts:53`) swallows a port-bind failure into an unhandled rejection. Move boot into an explicit `main()` and await/handle `listen`.

### [SEVERITY: Low] Spawn-secret comparison is not constant-time

- `spawn.ts:57` compares the internal secret with `!==`. Low practical risk (internal network, long random secret), but `timingSafeEqual` is already written in `packages/shared/src/server/api/ticket.ts:40` — reuse it.

### [SEVERITY: Low] Persist backoff uses global `setTimeout`, not the room clock

- `matchRoom.ts:575-577` — the retry sleep survives room disposal/server shutdown and is invisible to the (otherwise consistent) injected-clock discipline. Cosmetic unless tests ever need to fake it.

## Test coverage assessment

**Well covered (the pure core is exemplary):** lifecycle machine and seating (`lifecycle.test.ts`), intent loop incl. spoof/out-of-turn/resolved-room rejects (`intent.test.ts`), clock arithmetic (`clock.test.ts`), full handshake incl. fallback/reproducibility (`handshake.test.ts`), timeouts + ranked forfeit/abort/casual takeover (`integration.test.ts`, `abandonment.test.ts`), bot seating/authority/self-play to completion (`botseat.test.ts`, `bot-selfplay.test.ts`), record assembly (`persistence.test.ts`), DB writer against a live DB (`writer.db.test.ts`), onAuth ticket matrix (`onauth.test.ts`), spawn gateway (`spawn.test.ts`), and an API↔Match seam e2e (`seam.test.ts`).

**Untested critical paths (all adapter-side):**
- Malformed/hostile client messages — nothing sends a bad `intent` shape, a non-hex `clientSeed`, or a system-event-typed intent (the High findings above would all have been caught).
- `persistWithRetry` — no test for publish-fails-after-write (the duplication bug), retry exhaustion, or the record-loss path.
- `onLeave` → `allowReconnection` → grace-timer interplay under the real Colyseus clock (core-level reconnect is tested; the adapter race is not).
- Timer re-arm behavior (`reschedule`/`maybeDriveBot`) under real timers; the never-joined-room leak.

## Recommended action plan

**Quick wins (do first):**
1. **[S] Zod-validate `intent` and `contribute` messages** at the adapter; whitelist the five `PlayerIntent` kinds inside `submitIntent`; cap payload sizes. Closes both High message findings, including the fair-deal bypass.
2. **[S] Add `onUncaughtException`** to `MatchRoom` and try/catch in the two message handlers (log + drop).
3. **[S] Make persist idempotent**: hoist `matchId` out of the retry loop, retry write and publish independently, dump the record on final failure.
4. **[S] Fill-deadline for never-`Live` rooms**: one-shot timer in `onCreate`, dispose via the pre-live edge.
5. **[S] Clear `turnStartedAt` on a no-forced-move timeout** (busy-loop guard, `expireClock`).
6. **[S] Bot auto-contribution** on the `commit` effect (kills the 10 s/hand stall).
7. **[S] Add `'invalid-seat'` reject reason**; ignore-consented-leave decision documented or fixed.

**Medium refactors:**
8. **[M] Clock the `DeclareTrump`/`Bury` phases**: switch the clock path to `engineActingSeat`, add engine `TimeoutMove` coverage for both phases (small engine change, coordinate with engine audit).
9. **[M] Identity-based seating and reconnection**: store `playerId` on `SeatAssignment`, allow ticketed re-join into an own disconnected/bot-held seat; this is also the prerequisite for writing `match_participants`.
10. **[M] Deduplicate `joinRoom`/`seatBot`** via shared seat-selection/go-Live helpers; while in `core.ts` (1,019 lines), split record-assembly (`harvestHand`/`assembleMatchRecord`/`buildReplayBlob`) and abandonment resolution into sibling modules.
11. **[M] Adapter-level tests** for malformed messages, persist retry, and the reconnection race (a lightweight Colyseus test harness already exists in `matchRoom.test.ts` to build on).

**Larger:**
12. **[L] Move deal orchestration into the engine** (accept an injected `Rng`), export `sideOfSeat`, delete `deal.ts`'s mirrored logic — removes the standing drift risk between the live room and the rules/replay authority.
13. **[L] Durable outbox for failed persists** (a `failed_matches` table or disk spill + replayer) so a completed match can never be lost to transient DB/Redis outages.
