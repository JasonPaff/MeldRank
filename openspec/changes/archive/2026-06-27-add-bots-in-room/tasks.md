## 1. `@meldrank/bots` package scaffold

- [x] 1.1 Create `packages/bots` with `package.json` (name `@meldrank/bots`, `workspace:*` deps on `@meldrank/engine` and `@meldrank/shared`, no runtime IO deps), `tsconfig.json` extending the shared base, and `src/index.ts`, mirroring an existing pure package (e.g. `packages/fairness`).
- [x] 1.2 Wire the package into the workspace: add path alias / `workspace:*` references so `apps/match` can import `@meldrank/bots` as TS source, and confirm Turborepo picks it up (lint/typecheck/test targets resolve).

## 2. Bot brain (`bot-decision-policy`)

- [x] 2.1 Define the brain interface in `packages/bots`: `BotContext` (acting seat, difficulty selector, injected randomness source) and `brain(view: FilteredView, ctx: BotContext): PlayerIntent`, pure and IO-free.
- [x] 2.2 Implement the v1 random-legal policy: enumerate engine-legal moves from the filtered view (via `@meldrank/engine`) across bidding (bid/pass), trump declaration, and trick play; pick one using the injected randomness; return a forced action when only one is legal. Make no meld decision.
- [x] 2.3 Unit-test the brain: returned intent is always legal and for the acting seat; purity (same inputs + same randomness → same intent); decides only from filtered-view fields; forced-action case; each decision surface (bid/pass, trump, play).

## 3. Seat a bot in the core (`bot-seating`)

- [x] 3.1 Add a bot marker to `SeatAssignment` (e.g. `isBot: boolean`) in `apps/match/src/room/types.ts`; update `withSeat`/seating helpers and any seat constructors to set it (default `false` for humans).
- [x] 3.2 Implement a pure `seatBot` step in `apps/match/src/room/core.ts` (+ export from `room/index.ts`): seat a bot at the lowest free seat or a specified seat, with a synthetic connection id; refuse when the room is ranked, disposed, or full; reach `Live` via the existing fullness path when bots complete the room.
- [x] 3.3 Ensure bot seats count toward `isFull`/occupancy and that the authoritative `submitIntent` path applies bot intents through the identical seat-ownership / turn / engine-legality guards (no rules-layer special-casing).
- [x] 3.4 Unit-test the core: bot fills room to `Live`; ranked room refuses a bot; bot seat appears with synthetic connection + `isBot`; bot intent passes/fails the same authority guards as a human.

## 4. Adapter bot driver (`bot-seating`)

- [x] 4.1 In `apps/match/src/colyseus/matchRoom.ts`, after `run()` adopts a step, detect when `engine.public.seatToAct` is a bot-driven seat (cold-start `isBot` or `BotControlled` takeover) and is on the clock, the room is `Live`, and unresolved.
- [x] 4.2 Schedule the bot move on the existing `this.clock` after a randomized bounded think delay (configurable range, kept well under the move clock); maintain a single in-flight bot timer with clear/guard to prevent double-fire and re-entrancy issues.
- [x] 4.3 On fire: derive `viewFor(botSeat)` from the authoritative engine, call `brain(view, ctx)`, and submit via `submitIntent(core, botConnId, intent, correlationId, serverSeed, this.now)`; let the resulting `run()` drive any subsequent bot turn to completion.
- [x] 4.4 Surface a rejected bot intent loudly (log; it indicates a brain/legality bug) rather than silently retrying.

## 5. Casual takeover wiring (`bot-seating`, `match-disconnect-abandonment`)

- [x] 5.1 Replace `onBotTakeoverRequested`'s log-only stub so a `BotControlled` seat is driven by the same adapter bot driver (no separate path).
- [x] 5.2 Confirm the existing reconnection/reclaim path stops bot driving for a reclaimed seat and restores human control (resync unchanged).

## 6. Integration tests

- [x] 6.1 End-to-end (in `apps/match`): a Single-Deck Partners room with 1 stub human + 3 bots plays a full match to `Complete` and emits the `persist` effect (unit A path) — proving the engine→room→bot→persistence spine self-plays.
- [x] 6.2 Casual takeover: a human drops, grace expires, the bot assumes the seat and the match completes; a returning human reclaims the seat and resumes control.

## 7. Validation

- [x] 7.1 Run lint, typecheck, and tests via the validate agent across the affected packages (`@meldrank/bots`, `apps/match`); confirm green.
