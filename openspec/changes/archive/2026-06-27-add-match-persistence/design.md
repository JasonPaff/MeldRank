## Context

The match-room runtime (`apps/match`) plays full matches but persists nothing. `RoomCore` is a pure `(state, input) → { state, effects }` machine; the Colyseus `Room` is a thin adapter that performs IO. The `Complete → Persisted` transition is an explicit inert placeholder (`apps/match/src/room/core.ts` `completeAndPersist`), reached from **two** paths: a naturally scored-out match (`applyAdvanceBroadcast` when `advanced.public.phase === 'MatchComplete'`) and an abandonment resolution (`resolveForfeit` / `abortMatch`, which already populate `state.resolution`).

The durable target already exists and is tested (capability `match-record-store`): the `matches`, `match_hands`, `match_hand_lines`, `match_replays` Drizzle tables, the durable enums (`match_status`, `resolution_reason`, `participant_outcome`), and the pure `projectHand(input) → { hand, lines }` projector that takes a plain value object (no engine types — `shared` cannot import `engine`). The match service already constructs db + redis clients in `apps/match/src/index.ts` but does not use them.

The engine exposes everything the record needs on `state.public` at the scoring boundary: `handResult` (per-side `lines` + `made`), `scorePad.cumulative`, `contract` (bid winner seat + value), `trump`, and — at `MatchComplete` — `matchResult.standings` (per-side `placement` + `win`/`loss`). The shuffle handshake (`HandshakeContext`) holds each hand's `serverSeed` / `commit` / `contributions`, consumed and cleared at deal time.

This is **unit A** of the MVP roadmap (SLE-184). See `proposal.md` for motivation; capability `match-record-store` for the schema contract.

## Goals / Non-Goals

**Goals:**

- Produce a complete, durable record of every finished match (played-out **and** abandonment-resolved) in Postgres, plus a self-describing replay blob.
- Keep `RoomCore` pure: it accumulates and emits a `persist` effect; the adapter owns all IO and the `Complete → Persisted` advance.
- Announce each result over Redis for the API to consume, status-only — the heavy intent log + seeds stay durable, off the wire.
- Prove the engine→room→persistence spine with a four-stub integration test.

**Non-Goals:**

- `match_participants` and `abandon_events` (both FK `players.id`; no player rows under stubbed identity + non-player bots) — deferred to unit E.
- Real bots (units B/C), any `apps/api` consumer or `apps/web` surface, object-storage offload of the replay blob (the `storage_url` seam stays documented, not built).
- Rating math — the result event carries outcome **labels**, not numbers.

## Decisions

### D1 — Accumulate while `Live`, harvest at the scoring boundary

The engine resets `handResult` / `contract` / `trump` when the next hand opens (`openHand`), so the per-hand record must be harvested at the exact transition. Add a `record` accumulator to `RoomCoreState`:

```
interface MatchRecordAccumulator {
  readonly startedAt: number | null;          // injected clock stamped when the room goes Live
  readonly hands: readonly HandRecord[];       // one plain projector-input per scored hand
  readonly intents: readonly IntentLogEntry[]; // ordered player + timeout intents (replay blob only)
  readonly reveals: readonly HandReveal[];     // per-hand seed reveal (replay blob only)
}
```

- **Per-hand summary** — in `applyAdvanceBroadcast`, when `advanced.public.phase` is `HandScoring` **or** `MatchComplete`, harvest a `HandRecord` from `advanced.public` _before_ `beginHand` resets the engine. `HandRecord` mirrors `ProjectHandInput` exactly (`handNumber`, `bidderSeat = contract.seatIndex`, `contractValue = contract.value`, `trump`, `made`, `lines`, `cumulativeBySide = scorePad.cumulative`) — a plain value object, so the writer hands it straight to `projectHand()` with zero engine coupling. _Why a plain shape, not the engine value:_ preserves the projector's no-cycle contract and keeps the accumulator serializable.
- **Intent log** — append in `submitIntent` after legality passes (line ~392) and in `expireClock` for the forced timeout move, capturing seat + intent (or a `timeout` marker) in order. Replay-only.
- **Seed reveals** — capture in `dealAndBroadcast` (where the handshake is consumed) the hand's `handNonce` / `serverSeed` / `commit` / `contributions` / assembled seed. Safe to hold server-side: it only ever surfaces inside the durable blob written at match end. Replay-only.

_Alternative rejected:_ reconstruct the record from a final engine snapshot. Impossible — the discarded per-hand facts (intent order, seeds) are gone by match end. It is an accumulator, not a projection.

### D2 — `RoomCore` stays pure: completion emits a `persist` effect

Refactor `completeAndPersist` into `completeMatch(state): StepResult` that advances `Live → Complete` only (not `Persisted`), assembles the full `MatchRecord` payload, and returns `effects: [{ kind: 'persist', record }]`. Its three callers already build effect arrays, so each spreads the persist effect. The `Persisted` advance leaves the synchronous core path entirely.

Add a pure `markPersisted(state): StepResult` advancing `Complete → Persisted`, called by the adapter only after the write confirms. This follows the existing pattern where the adapter forwards server-side signal effects (`abandonResolution`, `abandonEvent`, `botTakeoverRequested`) to out-of-band consumers — `persist` is one more such effect.

```
{ kind: 'persist'; record: MatchRecord }   // new Effect variant
```

`MatchRecord` (assembled in the pure core, no DB id yet):

```
interface MatchRecord {
  readonly match: { mode; status; resolutionReason; variantId|null; variantVersion|null;
                    variantSnapshot; variantHash; startedAt; completedAt };
  readonly hands: readonly HandRecord[];        // writer folds each via projectHand()
  readonly outcomes: readonly { seat; outcome: 'win'|'loss'|'no_result' }[];  // for the result event
  readonly replay: ReplayBlobV1;                // serialized to bytea by the writer
}
```

### D3 — `status` / `resolution_reason` / `mode` / per-seat outcome derivation

One mapping table, computed in the pure core so the writer is dumb:

| Completion path              | `status`   | `resolution_reason`                    | per-seat `outcome` source                          |
| ---------------------------- | ---------- | -------------------------------------- | -------------------------------------------------- |
| Played out (`MatchComplete`) | `complete` | `played_out`                           | `matchResult.standings` → seat's side `win`/`loss` |
| Forfeit (`resolveForfeit`)   | `complete` | `forfeit_abandon` \| `timeout_abandon` | `resolution.outcomes`, normalized                  |
| Abort (`abortMatch`)         | `aborted`  | `aborted`                              | all `no_result`                                    |

`mode = ranked ? 'ranked' : 'casual'` (casual-only this slice). The abandonment labels normalize to the durable vocabulary exactly as the `participant_outcome` enum comment prescribes: `opponent_win → win`, `abandoner_loss` / `stranded_partner_reduced_loss → loss`, `no_result → no_result`. For played-out, map each seat to its side's standing via the variant partnership structure (same `partnerOf`-style lookup already in `core.ts`).

### D4 — Self-describing match envelope: `variant_snapshot` + `variant_hash`

`matches` requires `variant_snapshot` (jsonb) + `variant_hash` (notNull) and the store "neither computes nor validates them." The room is the producer: `variantSnapshot = state.variant` (the full `VariantDefinition`), and `variantHash` = a stable content hash of its canonical JSON via a small `@meldrank/shared` helper. `variantId` / `variantVersion` stay `null` (ad-hoc casual; the ranked registry id/version lands with ranked). _Why hash here:_ keeps every match self-describing and replayable even before a variant registry exists.

### D5 — Adapter owns the write, the id, the publish, and the `Persisted` advance

On a `persist` effect the Colyseus adapter:

1. **Transactionally** inserts `matches` (one row, `RETURNING id`), then per hand `projectHand()` → insert `match_hands` (`RETURNING id`) → insert its `match_hand_lines`, then `match_replays` (serialize `ReplayBlobV1` → `Buffer`/bytea). One transaction so a match never lands half-written.
2. **Publishes** the result event to Redis carrying the **DB-generated `matchId`** (this is why the event cannot come from the pure core — the id does not exist until the insert).
3. Drives `markPersisted` → `Complete → Persisted`, then disposes (disposal remains gated on `Persisted`).

### D6 — Redis result event: status-only, post-write (shared Zod contract)

New `@meldrank/shared` Zod schema `MatchResultEvent` — the API↔Match contract (unit D consumes it):

```
{ matchId; mode; status; resolutionReason; variantId|null; variantVersion|null;
  outcomes: [{ seat; outcome: 'win'|'loss'|'no_result' }] }
```

Published to a single channel `match.result`. The ordered intent log and seed reveals are **not** on the wire — they live only in `match_replays`.

### D7 — Replay blob: versioned, opaque, hex-encoded bytes

New `@meldrank/shared` type/schema `ReplayBlobV1` (`format='meldrank-replay'`, `schemaVersion=1`): variant snapshot + per-hand summaries + ordered intent log + seed reveals, with `Uint8Array` seeds hex-encoded for JSON. Serialized to a `Buffer` for the `bytea` column. Opaque to SQL; its meaning is owned solely by the match runtime, exactly as the `match_replays` doc states.

## Risks / Trade-offs

- **In-memory record until match end** → a match-service crash mid-match loses that match's record. _Mitigation:_ acceptable for the walking skeleton; the durable-outbox / incremental-persist hardening is future work and the `storage_url` seam is already reserved.
- **Write failure leaves the room at `Complete`, not `Persisted`** → _Mitigation:_ the adapter retries the transaction with bounded backoff; on permanent failure it logs and still disposes so the room never leaks. The result is lost rather than the process wedged. (A dead-letter path is future work.)
- **Existing lifecycle tests assert completion reaches `Persisted` synchronously** → they must move to "rests at `Complete`, emits `persist`, reaches `Persisted` only via `markPersisted`." Expected, contained churn — covered in tasks.
- **Accumulator grows with match length** (intent log + reveals) → bounded by a single match's hands; negligible for Partners. No cap needed this slice.
- **`variant_hash` computed locally, no registry yet** → two encoders of the "same" variant could differ. _Mitigation:_ canonical-JSON hashing is deterministic for the single in-repo variant source; the ranked registry will supply authoritative id/version/hash later.

## Migration Plan

No schema migration — the tables and enums already shipped. Roll out behind the existing match-service deploy: the new write path only activates at match completion, and the Redis channel has no consumer until unit D, so emitting early is harmless. Rollback is reverting the match-service change; the durable tables are additive and untouched by other code.

## Open Questions

- Redis channel granularity — single `match.result` topic (chosen) vs per-match `match:{id}:result`. The single topic is simpler for the unit-D subscriber; revisit if fan-out filtering becomes a problem.
- Whether `started_at` should be the room's `Live` transition or the first deal. Chosen: `Live` transition (matches "match began"); trivially movable.
