# Proposal: harden-match-wire-contract

## Why

The Client↔Match Colyseus wire protocol has no runtime contract: all 8 message names and every payload shape are hand-written twice (`apps/match/src/colyseus/matchRoom.ts` and `apps/web/lib/use-table-connection.ts:35-58`) with zero validation at the room boundary. This is both the repo's worst drift hazard (a server rename breaks the client only at runtime) and a live exploit: because `submitIntent` trusts its `PlayerIntent` type at runtime and the engine `reduce` accepts its full `Event` union, a client can send `{ type: 'deal', seed: <chosen>, seat: <own> }` during a contribution window (when `seatToAct` is null and the turn guard defers to the engine) and deal the hand from a seed it picked — a complete bypass of the provably-fair shuffle handshake (audit: docs/audit/app-match.md, docs/audit/cross-cutting-duplication.md, P0 items 1-2 in docs/audit/00-overview.md). Malformed payloads (`fromHex` on bad hex, missing fields) throw inside `onMessage` handlers with no room-level exception guard. The shared intent types themselves note the Zod schemas were deferred "when that boundary is built" (`packages/shared/src/intent/types.ts:9-10`) — the boundary was built without them.

## What Changes

- Add a single wire-contract module to `@meldrank/shared` (`packages/shared/src/match/wire.ts`): Zod schemas + inferred types for every Client↔Match room message — inbound `intent` (with a `PlayerIntentSchema` restricted to the five player intents, never the engine `Event` union) and `contribute` (hex-validated client seed), outbound `view`, `commit`, `accept`, `reject`, `rejectContribution`, `clockState` payloads, the join options (`ticket`), the synced `RoomMetadata` snapshot shape, and the canonical message-name constants and reject-reason union.
- `apps/match` parses every inbound client message with the shared schemas at the room boundary before anything touches `RoomCore` or the engine: a malformed or non-conforming payload produces a typed `reject` (with `correlationId` when one was legible) — never a throw, never a silent engine call. This structurally closes the seed-injection bypass: only `PlayerIntent`-shaped intents can reach `reduce`.
- `apps/match` defines `onUncaughtException` on the room so no future handler defect can crash the process from a client payload; unexpected errors are logged with the room context and the offending message kind.
- `apps/web` deletes its hand-written wire declarations (`AcceptMessage`, `CommitMessage`, `RejectMessage`, `SyncedMetadata`, message-name string literals) and imports names + types from the shared wire module; the client's `contribute` hex encoding uses the same helper contract the schema validates.
- Regression tests: a hostile-payload suite for the room boundary (system-event injection, malformed hex, missing/extra fields, oversized payloads) and a contract test asserting both apps compile against the same wire module.

**BREAKING**: none externally — the wire shapes are unchanged; this change pins and enforces them.

## Capabilities

### New Capabilities

- `match-wire-contract`: the single shared, Zod-validated Client↔Match wire protocol — message names, payload schemas, reject reasons, and the rule that both the match service and the web client consume it as their only source of wire types.

### Modified Capabilities

- `match-intent-loop`: inbound `intent` messages are runtime-validated against the shared schema before the authority checks; only the five player intents are accepted from clients — engine system events (`deal`, `timeout`) arriving over the wire are rejected, not adjudicated.
- `match-shuffle-handshake`: the `contribute` payload is schema-validated (well-formed, non-empty, byte-exact hex) at the boundary; a malformed contribution yields `rejectContribution`, never a handler throw, and can never reach the engine as a substitute deal.
- `match-room-lifecycle`: the room defines an uncaught-exception guard — no client-supplied payload may terminate the room or the process; unexpected handler errors are logged and contained.

## Impact

- **Code**: `packages/shared/src/match/wire.ts` (new) + shared exports; `apps/match/src/colyseus/matchRoom.ts` (message parsing, exception guard); `apps/web/lib/use-table-connection.ts` and `apps/web/lib/table-store.tsx` (import shared types, drop local declarations); tests in `packages/shared` and `apps/match`.
- **Dependencies**: none new — zod is already a shared dependency; the wire module must stay browser-safe (exported from the shared root, not `./server`).
- **Systems**: no deploy-order coupling — shapes are unchanged, so old client / new server (and vice versa) remain compatible during rollout.
- **Related audit items**: closes P0 items 1-2; unblocks the P1 constant-single-sourcing item (reconnect grace, seat enums) which can later live beside the wire module.
