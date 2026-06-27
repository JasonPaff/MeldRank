## 1. Shared contracts (`@meldrank/shared`)

- [x] 1.1 Add a stable variant-hash helper: canonical-JSON serialization of a `VariantDefinition` plus a content hash, exported for the room writer (design D4).
- [x] 1.2 Add the `ReplayBlobV1` type + Zod schema (`format='meldrank-replay'`, `schemaVersion=1`): variant snapshot, per-hand summaries, ordered intent log, hex-encoded seed reveals (design D7).
- [x] 1.3 Add the `MatchResultEvent` Zod schema — `matchId`, `mode`, `status`, `resolutionReason`, nullable `variantId`/`variantVersion`, per-seat `{ seat, outcome: win|loss|no_result }` — and the `match.result` channel constant (design D6).
- [x] 1.4 Unit-test the variant-hash determinism and round-trip the replay/result schemas.

## 2. RoomCore accumulator (`apps/match`, pure)

- [x] 2.1 Add accumulator types to `room/types.ts`: `MatchRecordAccumulator` (`startedAt`, `hands`, `intents`, `reveals`), `HandRecord` (mirrors `ProjectHandInput`), `IntentLogEntry`, `HandReveal`, and the `MatchRecord` payload; add `record` to `RoomCoreState` and the `persist` effect variant to the `Effect` union.
- [x] 2.2 Initialize the empty accumulator in `createRoomCore`; stamp `record.startedAt` on the `Filling → Live` transition (design D1).
- [x] 2.3 Harvest a `HandRecord` in `applyAdvanceBroadcast` when `advanced.public.phase` is `HandScoring` or `MatchComplete`, **before** `beginHand` resets the engine — extracting `bidderSeat`/`contractValue` from `contract`, plus `trump`, `handResult.made`/`lines`, and `scorePad.cumulative`.
- [x] 2.4 Append accepted player intents (`submitIntent`) and forced timeout moves (`expireClock`) to `record.intents` in order.
- [x] 2.5 Capture each hand's seed reveal in `dealAndBroadcast` (nonce, server seed, commit, contributions) before the handshake is cleared.

## 3. RoomCore completion → persist effect (`apps/match`, pure)

- [x] 3.1 Add a pure `assembleMatchRecord(state, completionPath)` building the `MatchRecord`: match envelope (mode/status/resolution_reason per the design D3 table, variant snapshot + hash), the per-hand `HandRecord`s, the per-seat normalized outcomes, and the `ReplayBlobV1`. (The completion path is read from `state.resolution`; `completedAt` is the injected clock instant.)
- [x] 3.2 Derive per-seat normalized outcomes: from `matchResult.standings` (seat→side→`win`/`loss`) for played-out; from `resolution.outcomes` normalized (`opponent_win→win`, `abandoner_loss`/`stranded_partner_reduced_loss→loss`, `no_result`) for abandonment.
- [x] 3.3 Refactor `completeAndPersist` into `completeMatch(state): StepResult` that advances `Live → Complete` only (not `Persisted`) and returns `effects: [{ kind: 'persist', record }]`; update its three callers (`applyAdvanceBroadcast`, `resolveForfeit`, `abortMatch`) to spread the persist effect into their effect arrays.
- [x] 3.4 Add a pure `markPersisted(state): StepResult` advancing `Complete → Persisted`; keep disposal gated on `Persisted`.
- [x] 3.5 Update `room/types.ts` lifecycle doc-comments: `Persisted` is now "durably written," reached only after the adapter confirms the write.

## 4. Colyseus adapter wiring (`apps/match`, IO)

- [x] 4.1 Wire the db + redis clients (already constructed in `apps/match/src/index.ts`) into the room adapter (`colyseus/matchRoom.ts`). (Injected via the Colyseus room-definition options.)
- [x] 4.2 Implement the transactional Neon writer for a `persist` effect: insert `matches`; per hand `projectHand()` → insert `match_hands` → insert `match_hand_lines`; insert `match_replays` (serialize `ReplayBlobV1` → `Buffer`/bytea) — all in one transaction (spec: durable write). (The Neon HTTP driver has no interactive transactions, so row ids are generated up front with `randomUUID` and the whole match is sent as a single `db.batch([...])`, which Neon executes as one transaction.)
- [x] 4.3 On commit, publish the `MatchResultEvent` (carrying the generated `matchId`) to the `match.result` Redis channel.
- [x] 4.4 On confirmed write+publish, call `markPersisted` and dispose; on permanent write failure, retry with bounded backoff, then log and dispose without advancing to `Persisted` (spec: durable write drives the Persisted transition).

## 5. Verification

- [x] 5.1 Unit-test the accumulator and `assembleMatchRecord` in `RoomCore`: per-hand harvest at the scoring boundary, intent-log order, seed-reveal capture, and the status/reason/outcome derivation for played-out, forfeit, and abort paths.
- [x] 5.2 Update existing lifecycle/room tests that assert synchronous `Persisted` to the new "rests at `Complete`, emits `persist`, reaches `Persisted` via `markPersisted`" behavior.
- [x] 5.3 Add an integration test driving a four-stub-seat full Single-Deck Partners match to completion and asserting the persisted `matches` + scorecard + `match_replays` rows and the emitted `MatchResultEvent` (the engine→room→persistence spine).
- [x] 5.4 Run the validate agent (lint, typecheck, test) and confirm clean.
