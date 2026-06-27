## 1. Core data model (`apps/match/src/room/types.ts`)

- [x] 1.1 Add `SeatConnectionStatus = 'Connected' | 'Disconnected' | 'BotControlled'` and extend `SeatAssignment` with `connectionStatus` and `graceDeadline: number | null` (D1); default new seats to `Connected`, `graceDeadline: null` in `seating.ts` `withSeat`.
- [x] 1.2 Add `reconnectGraceMs` to `ClockConfig` and set its default (90_000) in `DEFAULT_CLOCK_CONFIG` (D3).
- [x] 1.3 Add `resolution: ResolutionState | null` to `RoomCoreState`, where `ResolutionState = { reason: ResolutionReason; outcomes: readonly SeatOutcome[] }`, `ResolutionReason = 'forfeit_abandon' | 'timeout_abandon' | 'aborted'`, and `SeatOutcome = { seat: number; outcome: 'abandoner_loss' | 'stranded_partner_reduced_loss' | 'opponent_win' | 'no_result' }` (D5, D9); initialize `null` in `createRoomCore`.
- [x] 1.4 Extend `PendingDeadline['kind']` with `'grace'` and add an optional `seat` for the grace case (D2).
- [x] 1.5 Add the new effects to `Effect`: `abandonResolution` (reason + outcomes), `abandonEvent` (seat + reason, the leaver-penalty hook), `botTakeoverRequested` (seat), and a reconnection `view`/`clockState` reuse (no new kind needed for resync).

## 2. Grace window + reconnection (`apps/match/src/room/core.ts`)

- [x] 2.1 Rewrite `leaveRoom`: keep the pre-`Live` free-the-seat behavior; while `Live`, mark the seat `Disconnected` and stamp `graceDeadline = now + config.reconnectGraceMs`, leaving the seat assignment and engine `State` untouched (capability `match-disconnect-abandonment`: "Disconnect detection and grace window"). Thread the injected `Clock` into `leaveRoom`.
- [x] 2.2 Add `reconnect(state, token, newConnectionId, clock)`: find the seat by `token`, rewrite its `connectionId`, clear `graceDeadline`, set `Connected` (also from `BotControlled`), and emit a `view` + `clockState` resync to the new connection (D4; "Reconnection within grace resyncs the seat"). No-op / non-restoring when the seat is already resolved.
- [x] 2.3 Extend `pendingDeadline` to return the earliest of contribution close, turn expiry, and every disconnected seat's `graceDeadline`, with the right `kind`/`seat` (D2; "Move clock and grace run concurrently").

## 3. Abandonment resolution (`apps/match/src/room/core.ts` + partnership helper)

- [x] 3.1 Add a `partnerOf(variant, seat)` helper resolving the abandoner's partner from the Variant Definition seating/partnership structure (D6); return `null` for partnerless variants (Cutthroat).
- [x] 3.2 Add the shared `resolveForfeit(state, abandonerSeat, reason)`: compute per-seat outcomes (abandoner `abandoner_loss`, partner `stranded_partner_reduced_loss`, others `opponent_win`), set `resolution`, run `completeAndPersist`, and emit `abandonResolution` + `abandonEvent` (D5; "Ranked grace expiry resolves as a forfeit", "Abandon event emitted").
- [x] 3.3 Add `abortMatch(state, reason)`: every seat outcome `no_result`, set `resolution`, run out to terminal, emit `abandonResolution` only (no `abandonEvent`) (D7; "Multi-drop and crash abort").
- [x] 3.4 Add `expireGrace(state, seat, clock, seed)`: re-guard the grace deadline; in a ranked room, if another seat is already past grace unresolved → `abortMatch`, else `resolveForfeit(..., 'forfeit_abandon')`; in a casual room mark the seat `BotControlled` and emit `botTakeoverRequested` without resolving (D7, D8; "Casual grace expiry requests a reclaimable bot takeover").
- [x] 3.5 Update `expireClock`: when the ranked timeout tally crosses `timeoutAbandonThreshold`, additionally call `resolveForfeit(..., 'timeout_abandon')` after emitting the existing `abandonmentSignal`, so the signal now drives resolution (delta `match-move-clocks`; "Ranked repeated-timeout abandonment resolves as a forfeit").
- [x] 3.6 Ensure `submitIntent` rejects/ignores intents once `resolution !== null` (resolved room rejects further intents).

## 4. Colyseus adapter (`apps/match/src/colyseus/matchRoom.ts`)

- [x] 4.1 `onLeave`: while `Live`, call `leaveRoom` then `allowReconnection(client, graceSeconds)`; on the resolved reconnected client call `reconnect(core, token, newSessionId, now)` and `run` the result; on reconnection rejection let the grace timer resolve.
- [x] 4.2 Extend the timer dispatch in `reschedule`: route a `'grace'` pending deadline to `expireGrace(core, seat, now, serverSeed)` alongside the existing `'turn'`/`'contribution'` cases.
- [x] 4.3 Wire the new effects in `emit`: forward `abandonEvent` to a stubbed leaver-penalty hook (log, like `onAbandonmentSignal`), `botTakeoverRequested` to a stubbed bot-seating hook, and `abandonResolution` to a logged terminal-result hook (all real consumers are slices #5/#6 and the Anti-Cheat doc).
- [x] 4.4 Reflect `connectionStatus` per seat into `RoomMetadata` presence (extend `schema.ts` occupancy/status) so the lobby/table UI can show a disconnected/bot seat.

## 5. Tests (`apps/match/src/room/*.test.ts`)

- [x] 5.1 Grace lifecycle: `Live` drop → `Disconnected` + stamped deadline; pre-`Live` drop still frees the seat; reconnect within grace restores + resyncs (token-keyed, new connection id); reconnect after resolution is not honored.
- [x] 5.2 Concurrent deadlines: `pendingDeadline` returns the earliest of turn vs grace; move-clock fires first → forced move, grace continues; grace fires first → resolution (deterministic injected clock).
- [x] 5.3 Ranked forfeit: grace expiry and timeout-threshold crossing both produce `forfeit_abandon`/`timeout_abandon` with correct per-seat outcomes (abandoner loss, stranded partner reduced, opponents win) on Single-Deck Partners; `abandonEvent` emitted; room runs out to `Disposed`; no bot seated.
- [x] 5.4 Abort: two seats past grace → `aborted`, all `no_result`, no `abandonEvent`, no fabricated winner.
- [x] 5.5 Casual takeover: grace expiry → `BotControlled` + `botTakeoverRequested`, match not resolved; returning human reclaims and resyncs; no forfeit/abort on a single casual disconnect.
- [x] 5.6 Update existing `integration.test.ts`/`intent.test.ts` for the `leaveRoom` signature change and the resolved-room intent rejection.

## 6. Validation

- [x] 6.1 Run lint, typecheck, and the `apps/match` test suite via the validate agent; confirm a clean summary and that the new specs match the implemented behavior.
