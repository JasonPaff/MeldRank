## Why

The match-room runtime plays full matches to completion but persists nothing: the `Complete → Persisted` lifecycle transition is an explicit inert placeholder (`apps/match/src/room/core.ts`), and the durable schema + pure `projectHand()` projector shipped (capability `match-record-store`) have no writer. This is **unit A** of the MVP first-deploy roadmap (SLE-184) — the engine→room→persistence spine. Until a completed match lands a row in Postgres and announces its result, no downstream surface (API, history, the eventual ladder) has anything to read, and there is no end-to-end proof that an authoritative match produces a durable, trustworthy record.

## What Changes

- **Accumulate the durable record while the match is `Live`.** The engine and shuffle handshake discard per-hand facts as the match advances — the bidder/contract/trump/made verdict, the per-side as-scored lines, the ordered player+timeout intent log, and each hand's seed reveal. `RoomCore` captures these into its state as they occur (at each hand-scoring boundary and on every accepted intent), so the full record exists in memory when the match ends.
- **Write the completed match to Neon at `Complete`.** Fold the accumulated per-hand data through the existing pure `projectHand()` and write the four player-FK-free tables directly from the match service: `matches`, `match_hands`, `match_hand_lines`, and a versioned `match_replays` blob (`format='meldrank-replay'`, `schema_version=1`).
- **Make the write authoritative over the lifecycle.** `RoomCore` stays pure: on completion it emits a `persist` effect carrying the fully-assembled record instead of advancing straight to `Persisted`. The Colyseus adapter performs the async Neon write, then drives `Complete → Persisted` only once the write confirms (and disposes only from `Persisted`). Both completion paths — a naturally scored-out match and an abandonment/abort resolution — persist through the same seam.
- **Emit a status-only result event over Redis pub/sub.** On a confirmed write, publish a small result payload — per-seat outcome, variant id + version, and resolution reason — for the API to consume. The heavy ordered intent log and seed reveals stay in the durable replay blob, **not on the wire**.
- **Verify end-to-end** with a scripted four-stub-seat integration test that drives a full Single-Deck Partners match to a persisted match row + scorecard + replay blob and the emitted result event.

Out of scope (deferred): `match_participants` and `abandon_events` (both FK `players.id`, which has no rows under stubbed identity + non-player bots — deferred to the auth/identity slice, unit E); bots-in-room (unit B) and bot decision logic (unit C); any `apps/api` or `apps/web` surface.

## Capabilities

### New Capabilities

- `match-persistence`: the match service's durable write of a completed or resolved match — the `RoomCore` accumulator that captures per-hand scoring, the ordered intent log, and seed reveals while `Live`; assembly of the versioned replay blob; the `persist` effect and the adapter's transactional write of `matches` + `match_hands` + `match_hand_lines` + `match_replays` to Neon; and the status-only result event published over Redis on a confirmed write.

### Modified Capabilities

- `match-room-lifecycle`: the `Persisted` state stops being an inert placeholder. The room emits a `persist` effect on completion and the adapter advances `Complete → Persisted` only after the durable write confirms; disposal remains gated on `Persisted`.

## Impact

- **Code:** `apps/match` — `RoomCore` (`room/core.ts`) gains accumulator state and a `persist` effect; `room/types.ts` gains the accumulator + effect + record-payload types; the Colyseus adapter (`colyseus/matchRoom.ts`) gains the async Neon writer, the post-write `Persisted` transition, and the Redis publish, wiring up the db/redis clients already constructed but unused in `apps/match/src/index.ts`.
- **Packages:** consumes `@meldrank/shared` server db (schema + `projectHand`) as-is; new Zod schema(s) in `@meldrank/shared` for the replay blob payload and the Redis result message (the API↔Match contract).
- **Data:** first writes to `matches`, `match_hands`, `match_hand_lines`, `match_replays` (Neon). No new migrations — schema already shipped.
- **Infra/contracts:** establishes the API↔Match Redis result channel consumed later by unit D. No auth, no player FKs.
