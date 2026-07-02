# Tasks: harden-match-wire-contract

## 1. Shared wire-contract module (design D1/D2)

- [ ] 1.1 Create `packages/shared/src/match/wire.ts`: `WireMessages` name constants for all 8 messages, `PlayerIntentSchema` (strict discriminated union of the five intents, reusing the variant-schema `Rank`/`Suit` zod enums for `CardRef`), `IntentMessageSchema` (`{ intent, correlationId }`), `ContributeMessageSchema` (byte-exact 32-byte hex regex), outbound payload schemas (`AcceptPayloadSchema`, `RejectPayloadSchema`, `CommitPayloadSchema`, `ClockStatePayloadSchema`, `RejectContributionPayloadSchema`), `JoinOptionsSchema`, the `SyncedMetadataSnapshot` type, and the `WireRejectReason` union including `'malformed-message'`; export everything from the shared root `index.ts`
- [ ] 1.2 Add the two-way type-level drift guard in shared: `z.infer<typeof PlayerIntentSchema>` mutually assignable with `PlayerIntent` (compile-time assertion in `wire.test.ts`)
- [ ] 1.3 Write `packages/shared/src/match/wire.test.ts`: accept matrix (all five well-formed intents), reject matrix (`deal`, `timeout`, unknown discriminants, missing/mistyped/extra fields via `.strict()`, malformed/odd-length/wrong-length/empty hex for `contribute`), and browser-safety (no `@meldrank/shared/server`/Node-builtin imports in the wire module's graph)

## 2. Match room boundary validation (design D3/D4)

- [ ] 2.1 Add the `rejectMalformed(state, connectionId, correlationId | null)` entry to `apps/match/src/room/core.ts` emitting the existing `reject` effect (reason `'malformed-message'`, `safeView` resync) so malformed rejects are wire-identical to core rejects
- [ ] 2.2 Rework `matchRoom.ts` `onMessage('intent')`: `IntentMessageSchema.safeParse` first; on failure extract a legible string `correlationId` from the raw payload and run `rejectMalformed`; only a parsed message reaches `submitIntent`
- [ ] 2.3 Rework `matchRoom.ts` `onMessage('contribute')`: `ContributeMessageSchema.safeParse`; on failure send `rejectContribution` `{ reason: 'malformed' }` from the adapter; `fromHex` is only ever called on schema-valid input
- [ ] 2.4 Replace `matchRoom.ts`'s local `IntentMessage`/`ContributeMessage` interfaces and all message-name literals with imports from the shared wire module; annotate every `client.send` payload in `emit()` with `satisfies` against the wire payload types
- [ ] 2.5 Implement `onUncaughtException(err, methodName)` on `MatchRoom`: log `{ err, methodName }` on the room logger at error level, keep the room alive (verify hook signature against the installed colyseus version)

## 3. Hostile-payload regression suite (design D6)

- [ ] 3.1 Room-boundary tests in `apps/match`: injected `{ type: 'deal', seed, seat }` during an open contribution window is rejected and the hand deals from the handshake-assembled seed; injected `{ type: 'timeout' }` is rejected with no seat charged
- [ ] 3.2 Malformed-payload tests: non-object/missing-field/mistyped/extra-field `intent` payloads → `reject` with `'malformed-message'` (echoing a legible `correlationId`), malformed hex `contribute` → `rejectContribution`, no handler throw in any case, engine state unchanged
- [ ] 3.3 Containment test: a hostile burst across both channels from one connection leaves the room serving other seats' intents (lifecycle still `Live`, subsequent legal move accepted)

## 4. Web client consumption (design D5)

- [ ] 4.1 In `apps/web/lib/use-table-connection.ts`: delete `AcceptMessage`/`CommitMessage`/`RejectMessage`/`SyncedMetadata` and message-name literals; import names + payload types from `@meldrank/shared`; replace the local `toHex` with `@meldrank/fairness`'s
- [ ] 4.2 In `apps/web/lib/table-store.tsx`: derive `ClockStateSnapshot`/`SyncedMetadataSnapshot` from the wire module types instead of local declarations
- [ ] 4.3 Typecheck-level contract closure: confirm no remaining hand-written wire shape or name literal in `apps/web` (grep for the 8 message names as string literals outside shared)

## 5. Validation & verification

- [ ] 5.1 Run the validate agent (lint, typecheck, test) across the workspace and resolve findings
- [ ] 5.2 End-to-end check: play a full bot match in the browser (create quick play → bid/meld/tricks → match completes and persists) confirming the pinned shapes changed nothing behaviorally
- [ ] 5.3 Update `docs/audit/00-overview.md`: mark P0 items 1–2 done with a pointer to this change
