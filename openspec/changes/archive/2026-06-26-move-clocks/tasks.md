## 1. Clock seam, types, and config

- [x] 1.1 Add `Clock = () => number` (monotonic ms) seam type to `apps/match/src/room/types.ts`, mirroring `ServerSeedSource`.
- [x] 1.2 Add `ClockConfig { baseMs, reserveMs, contributionWindowMs, timeoutAbandonThreshold }` with locked defaults (20_000 / 90_000 / ~10_000 / ~3) and wire it into `createRoomCore`.
- [x] 1.3 Add per-seat clock fields to `RoomCoreState`/`SeatAssignment`: `remainingBaseMs`, `remainingReserveMs`, `timeoutCount`; add turn-level `turnStartedAt` and the current pending `contributionDeadline`.
- [x] 1.4 Add new `Effect` kinds: `clockState` (per-recipient, carries acting seat's remaining base/reserve + deadline) and `abandonmentSignal` (identifies a seat).

## 2. Pure clock logic (`apps/match/src/room/clock.ts`)

- [x] 2.1 Implement `chargeElapsed(seatClock, elapsedMs)` → deducts from base first, then reserve, never below zero; returns updated seat clock.
- [x] 2.2 Implement `deadlineFor(turnStartedAt, seatClock)` → `turnStartedAt + remainingBase + remainingReserve` (pure).
- [x] 2.3 Implement `grantBase(seatClock, config)` → resets `remainingBaseMs` to `config.baseMs`, leaves reserve untouched (non-refilling).
- [x] 2.4 Unit-test charge/deadline/grant edge cases: act within base, overflow into reserve, reserve exhaustion, reserve persisting across turns.

## 3. Integrate clocks into the intent loop

- [x] 3.1 Extract the post-`reduce` advance+broadcast tail of `submitIntent` into a shared `applyAdvanceBroadcast` helper (used by both player intents and timeout events).
- [x] 3.2 In `submitIntent`, thread `Clock`: on accept, charge the acting seat's elapsed time, then `grantBase` + stamp `turnStartedAt` for the new acting seat returned by the engine.
- [x] 3.3 Append `clockState` effects to every broadcast (acting seat's remaining base/reserve + deadline; include all seats' banks if cheap — see open question).
- [x] 3.4 Update `intent.test.ts`/`integration.test.ts` to assert clock charging and reset across turns.

## 4. Clock expiry → engine timeout policy

- [x] 4.1 Implement `expireClock(state, now): StepResult` — zero the acting seat's base+reserve, build the engine `TimeoutEvent { type:'timeout', seat }`, call `reduce(engine, event)` directly (bypassing player guards), then run `applyAdvanceBroadcast`.
- [x] 4.2 Guard against early fire: if `now` is before the computed deadline, no-op and let the adapter reschedule.
- [x] 4.3 Increment the seat's `timeoutCount`; when it crosses `timeoutAbandonThreshold` in a ranked room, append an `abandonmentSignal` effect (no forfeit/substitution this slice).
- [x] 4.4 Test auction timeout (forced pass), trick-play timeout (forced lowest-value legal play), and that the forced move uses the identical broadcast path as a player move.

## 5. Contribution-window deadline (close the slice-#2 seam)

- [x] 5.1 In `beginHand`, stamp `contributionDeadline = now + config.contributionWindowMs`.
- [x] 5.2 In `submitContribution`, reject contributions after the deadline (in addition to the existing pre-commit rejection).
- [x] 5.3 Implement `closeContributionWindow(state, now): StepResult` — deal via existing `assembleSeed` + `fallbackContribution` for absent seats; retain the "all seats contributed early" fast-path close.
- [x] 5.4 Update `handshake.test.ts` for deadline close, early-close fast-path, and late-contribution rejection.

## 6. Colyseus adapter — the wall-clock timer

- [x] 6.1 In `matchRoom.ts`, maintain a single pending deadline timer using Colyseus's deterministic clock; after each `run(step)`, clear and reschedule it from the new state's acting-seat deadline (or contribution deadline).
- [x] 6.2 On timer fire, call `expireClock`/`closeContributionWindow` with the injected `now`, then `run` the result.
- [x] 6.3 Translate the new `clockState` and `abandonmentSignal` effects in `emit(...)` (`clockState` → `client.send`; `abandonmentSignal` → log/publish stub for slice #4).
- [x] 6.4 Provide the production `Clock` (monotonic `now`) and surface the on-clock deadline on `RoomMetadata` (`schema.ts`) if useful for the lobby.

## 7. Validation

- [x] 7.1 Run lint, typecheck, and the full test suite via the validate agent; resolve any failures.
- [x] 7.2 Confirm `openspec validate move-clocks --strict` passes and the change is ready to archive.
