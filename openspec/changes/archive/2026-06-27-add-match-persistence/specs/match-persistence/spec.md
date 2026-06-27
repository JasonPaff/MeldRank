## ADDED Requirements

### Requirement: Room accumulates the durable match record while Live

While a room is `Live`, `RoomCore` SHALL accumulate the data needed to durably record the match into its own state as that data occurs, because the engine and the shuffle handshake discard per-hand facts as the match advances. The accumulator SHALL capture, per scored hand, the bidding context and made/set verdict in a plain projector-input shape (carrying no `@meldrank/engine` types); the ordered log of every accepted player intent and forced timeout move; and each hand's seed reveal (hand nonce, server seed, commitment, and seat contributions). The per-hand summary SHALL be harvested at the `HandScoring`/`MatchComplete` transition, before the next hand resets the engine.

#### Scenario: Per-hand summary harvested at the scoring boundary

- **WHEN** a hand reaches `HandScoring` or `MatchComplete`
- **THEN** the room appends one per-hand record carrying `handNumber`, `bidderSeat`, `contractValue`, `trump`, `made`, the per-side as-scored `lines`, and the cumulative-by-side scores, derived from the engine state at that transition
- **AND** the record is a plain value object suitable for `projectHand()` with no engine-type coupling

#### Scenario: Ordered intent log captured

- **WHEN** a player intent is accepted or a forced timeout move resolves
- **THEN** the room appends it to the ordered intent log in occurrence order

#### Scenario: Per-hand seed reveal captured before the handshake is cleared

- **WHEN** a hand's deal window closes and the hand is dealt
- **THEN** the room captures that hand's nonce, server seed, commitment, and seat contributions into the accumulator before the handshake context is discarded

### Requirement: Match completion emits a single persist effect

When a match terminates, `RoomCore` SHALL advance `Live → Complete`, assemble the complete match record, and emit exactly one `persist` effect carrying that record. The pure core SHALL NOT advance to `Persisted` itself and SHALL NOT perform any IO. Both completion paths — a naturally scored-out match and an abandonment resolution (forfeit or abort) — SHALL emit the same `persist` effect through the same seam.

#### Scenario: Played-out match emits persist at Complete

- **WHEN** the engine reports the match complete during the per-hand loop
- **THEN** the room advances to `Complete` and emits a single `persist` effect carrying the assembled record
- **AND** the room does not advance to `Persisted` in the same step

#### Scenario: Abandonment resolution emits persist at Complete

- **WHEN** a forfeit or abort resolution terminates a `Live` match
- **THEN** the room advances to `Complete` and emits a `persist` effect carrying the assembled record, alongside the existing abandonment-resolution effects

### Requirement: Match envelope is self-describing with derived status and reason

The assembled match record SHALL describe the match without external lookup: a `variant_snapshot` (the full `VariantDefinition`) and a stable `variant_hash` of its canonical form, with `variant_id`/`variant_version` left null for ad-hoc casual matches. The record SHALL derive `mode`, `status`, and `resolution_reason` from the completion path. A played-out match SHALL be `complete` / `played_out`; a forfeit SHALL be `complete` with reason `forfeit_abandon` or `timeout_abandon`; an abort SHALL be `aborted` / `aborted`.

#### Scenario: Played-out match status and reason

- **WHEN** the record is assembled for a scored-out match
- **THEN** `status` is `complete` and `resolution_reason` is `played_out`

#### Scenario: Forfeit and abort status and reason

- **WHEN** the record is assembled for a forfeit resolution
- **THEN** `status` is `complete` and `resolution_reason` is the forfeit reason (`forfeit_abandon` or `timeout_abandon`)
- **WHEN** the record is assembled for an abort resolution
- **THEN** `status` is `aborted` and `resolution_reason` is `aborted`

#### Scenario: Variant is captured as a self-describing snapshot

- **WHEN** the record is assembled
- **THEN** it carries a `variant_snapshot` and a stable `variant_hash`
- **AND** `variant_id` and `variant_version` are null for an ad-hoc casual match

### Requirement: Durable write of the player-FK-free tables in one transaction

On a `persist` effect the match service SHALL write the completed match to Postgres in a single transaction: one `matches` row; for each accumulated hand, the `projectHand()`-projected `match_hands` row and its `match_hand_lines` rows; and one `match_replays` row carrying the versioned replay blob. The write SHALL NOT touch `match_participants` or `abandon_events` in this slice. A match SHALL NEVER be left half-written.

#### Scenario: Completed match is written transactionally

- **WHEN** the adapter receives a `persist` effect for a finished match
- **THEN** it inserts the `matches` row, the `match_hands` and `match_hand_lines` rows folded through `projectHand()`, and the `match_replays` blob within one transaction
- **AND** a failure at any step rolls back the whole match write

#### Scenario: Player-FK tables are not written this slice

- **WHEN** a match is persisted
- **THEN** no `match_participants` or `abandon_events` rows are written

#### Scenario: Replay blob is versioned and self-describing

- **WHEN** the `match_replays` row is written
- **THEN** its `format` is `meldrank-replay` and its `schema_version` is `1`
- **AND** its `data` is the opaque serialized blob carrying the variant snapshot, per-hand summaries, ordered intent log, and seed reveals

### Requirement: Status-only result event published on a confirmed write

After the durable write commits, the match service SHALL publish a single status-only result event over Redis for the API to consume. The event SHALL carry the database-generated `matchId`, the `mode`, `status`, `resolution_reason`, the nullable `variant_id`/`variant_version`, and the per-seat outcome normalized to the durable `win`/`loss`/`no_result` vocabulary. The ordered intent log and the seed reveals SHALL NOT appear in the event — they remain only in the durable replay blob.

#### Scenario: Result event carries the persisted identity and outcomes

- **WHEN** the match write commits
- **THEN** the service publishes a result event carrying the database-generated `matchId`, the mode/status/resolution reason, the variant id/version, and the per-seat normalized outcome

#### Scenario: Abandonment outcome labels are normalized

- **WHEN** a forfeit result event is published
- **THEN** `opponent_win` is published as `win`, and `abandoner_loss` and `stranded_partner_reduced_loss` are published as `loss`

#### Scenario: Heavy record stays off the wire

- **WHEN** a result event is published
- **THEN** it contains no ordered intent log and no seed reveals

### Requirement: The durable write drives the Persisted transition

The match service SHALL advance the room `Complete → Persisted` only after the durable write has confirmed, then dispose the room. If the write fails, the service SHALL retry with bounded backoff; on permanent failure it SHALL log the failure and still dispose so the room does not leak, leaving the room at `Complete` until disposal.

#### Scenario: Confirmed write advances and disposes

- **WHEN** the durable write commits and the result event is published
- **THEN** the service advances the room to `Persisted` and then disposes it

#### Scenario: Failed write does not advance to Persisted

- **WHEN** the durable write permanently fails after retries
- **THEN** the room is not advanced to `Persisted`
- **AND** the service logs the failure and still disposes the room
