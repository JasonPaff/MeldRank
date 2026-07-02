# Design: harden-match-wire-contract

## Context

The Client↔Match room protocol is 8 messages: inbound `intent` (`{ intent, correlationId }`, handled at `apps/match/src/colyseus/matchRoom.ts:192`) and `contribute` (`{ clientSeed }`, `matchRoom.ts:195`); outbound `view`, `commit`, `accept`, `reject`, `rejectContribution`, `clockState` (emitted at `matchRoom.ts:438-457`). Neither inbound handler validates: `message.intent` flows straight into `submitIntent` → engine `reduce`, which accepts its full `Event` union — so a crafted `{ type: 'deal', seed, seat }` sent while the contribution window is open (engine `seatToAct` is null, so the turn guard at `core.ts:512` defers to the engine) deals the hand from a client-chosen seed. `fromHex` throws on malformed hex inside the `contribute` handler. On the client, `apps/web/lib/use-table-connection.ts:35-58` hand-declares `AcceptMessage`/`CommitMessage`/`RejectMessage`/`SyncedMetadata` and repeats every message-name literal, with no compile-time link to the server. `packages/shared/src/intent/types.ts` already declares itself "the shape later Match Service / client wiring will validate with Zod" — this change builds that deferred boundary. Constraints: engine stays zero-runtime-deps; shared root export must stay browser-safe; wire *shapes* must not change (no coordinated deploy).

## Goals / Non-Goals

**Goals:**
- One browser-safe wire module in `@meldrank/shared` that both apps consume for every message name and payload type.
- Every inbound client message parsed at the room boundary; malformed input → typed reject, never a throw, never an engine call.
- Client intents structurally restricted to the five-member `PlayerIntent` union — system events (`deal`, `timeout`) cannot arrive over the wire.
- `onUncaughtException` backstop so no payload can kill the room/process.
- Hostile-payload regression suite.

**Non-Goals:**
- No wire-shape changes, renames, or protocol versioning (shapes are pinned as-is).
- No client-side runtime parsing of server payloads (server is authoritative; types suffice — revisit if a spectator/replay client ever consumes untrusted relays).
- No consolidation of other duplicated constants (reconnect grace, seat enums) — that is P1 item 14, though the wire module is where they will later live.
- No changes to `RoomCore` authority logic, the handshake protocol, or the engine.

## Decisions

**D1 — Wire module lives at `packages/shared/src/match/wire.ts`, exported from the shared root.** It defines: message-name constants (single `WireMessages` const object with the 8 names), `IntentMessageSchema`, `ContributeMessageSchema`, outbound payload schemas (`AcceptPayloadSchema`, `RejectPayloadSchema`, `CommitPayloadSchema`, `ClockStatePayloadSchema`, `RejectContributionPayloadSchema` — `view` payloads are typed as the engine's `FilteredView` via a type-only import, not schematized), `JoinOptionsSchema` (`{ ticket?: string }`), the `SyncedMetadataSnapshot` type, and a `WireRejectReason` closed union extended with `'malformed-message'`. Alternative considered: a new `./wire` subpath export — rejected; the root is already browser-safe and web already imports match contracts from it.

**D2 — `PlayerIntentSchema` is a Zod discriminated union that mirrors, not replaces, `intent/types.ts`.** The hand-written interfaces are the locked contract the engine consumes type-only; converting them to `z.infer` would put zod into the engine's type-resolution chain while its zero-runtime-deps invariant is already fragile (audit P1 item 10). Drift is prevented statically: a two-way type-level assertion (`z.infer<typeof PlayerIntentSchema>` mutually assignable with `PlayerIntent`) compiled in shared's tests. Schema is **shape-strict, rules-loose**: it enforces discriminants, field types, `Rank`/`Suit` enums (reusing the existing variant-schema zod enums), integer seat/value/copyIndex — but not game legality (bid ranges, card ownership), which stays the engine's sole authority. `.strict()` object schemas so unknown keys fail parsing.

**D3 — Boundary parsing in the room adapter, malformed rejects through the core's effect machinery.** `onMessage('intent')` runs `IntentMessageSchema.safeParse`; on failure it extracts a legible string `correlationId` from the raw payload (else `null`) and calls a new thin `rejectMalformed(state, connectionId, correlationId)` core entry that emits the existing `reject` effect via `safeView` — so the reject wire shape (`{ correlationId, reason, view }`) is byte-compatible with what clients already handle. `onMessage('contribute')` parses `ContributeMessageSchema` (regex `^(?:[0-9a-fA-F]{2}){32}$` — byte-exact for the fairness layer's 32-byte seed) and on failure sends `rejectContribution` `{ reason: 'malformed' }` directly from the adapter (that path has no correlation/view). `fromHex` is then only ever called on schema-valid input. Alternative — parse inside `RoomCore`: rejected; the core's contract is typed inputs, and keeping validation in the adapter preserves the pure-core seam the audit praised.

**D4 — `onUncaughtException` is a logging backstop, not a flow.** Colyseus 0.16's `Room#onUncaughtException(err, methodName)` is implemented to log `{ err, methodName, roomId }` at error level and return (room stays alive). No rejects are sent from the guard — anything reaching it is a defect; boundary validation is the designed path for hostile input. Verify the hook's exact signature against the installed `colyseus` version at implementation time.

**D5 — Web deletes its wire declarations and imports the module; types only, no client-side parsing.** `use-table-connection.ts` drops `AcceptMessage`/`CommitMessage`/`RejectMessage`/`SyncedMetadata` and its name literals; `table-store.tsx`'s `ClockStateSnapshot`/`SyncedMetadataSnapshot` re-export or derive from the wire module. The local `toHex` helper (`use-table-connection.ts:329`) is replaced by `toHex` from `@meldrank/fairness` (already isomorphic, used by the server half of the same handshake — audit Low finding). Server-side, `emit()`'s send calls annotate payloads with `satisfies` against the wire types so the compiler pins the server's actual sends to the contract.

**D6 — Contract tests live where the contract lives.** Shared gets the schema unit tests (accept/reject matrices, the two-way type assertion). `apps/match` gets the hostile-payload suite driving the real room via the Colyseus test harness: injected `deal` during the contribution window (asserting the subsequent deal matches the handshake seed, not the injected one), injected `timeout`, malformed/oversized/non-object payloads on both channels, and a burst test asserting the room still serves the other seats afterward.

## Risks / Trade-offs

- [Schema and locked types drift as intents evolve] → the two-way assignability assertion fails the shared typecheck the moment either side changes alone.
- [Boundary rejects diverge from core rejects in shape] → malformed rejects reuse the core `reject` effect path and the shared `RejectPayloadSchema`; the wire tests parse real emitted payloads.
- [Zod parse cost on the hot intent path] → payloads are tiny (≤ a few hundred bytes); `.strict()` discriminated-union parse is microseconds against a network round-trip. Not measurable at table scale.
- [`onUncaughtException` masks real defects by keeping rooms alive] → guard logs at error level with `methodName`; treat any occurrence as a bug (the spec says so normatively).
- [Old clients in flight during rollout] → shapes are unchanged in both directions; a stale client's well-formed messages parse identically, and its malformed ones now get a clean reject instead of crashing the handler — strictly better. No deploy-order coupling.

## Migration Plan

Single PR, no data or protocol migration. Deploy order free (shapes pinned). Rollback is a straight revert. Post-deploy verification: `verify` flow — play a bot match end-to-end in the browser, then replay the hostile-payload suite against the deployed service's room via a scripted Colyseus client.

## Open Questions

- None blocking. (Noted for P1 item 14: `GRACE_MS`, seat-status/lifecycle string enums, and `SEAT_COUNT` should migrate into this wire module's neighborhood when constants are single-sourced.)
