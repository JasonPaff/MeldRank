## Why

The persistence plumbing exists (`data-persistence`: a Drizzle-over-Neon client, migration tooling, and an intentionally-empty schema home) but no domain tables live in it yet, so a finished match has nowhere to land. The Match Runtime room already carries a terminal resolution into its inert `Complete → Persisted` run-out, explicitly waiting on "slice #6" to durably write the record. This change defines the **durable match record** — the first writer-readiness slice of the Data Model design (Linear "Data Model — Design v1" §13): every table the room-writer needs to persist a completed match end-to-end and the API needs to read it back. It is **schema + pure projector only**; the room-as-writer behavior is a separate downstream change.

## What Changes

- **Players & identity.** A unified `players` table for humans and bots discriminated by `type`, with a nullable-but-unique `clerk_user_id` and a check constraint binding `type='human'` ⟺ `clerk_user_id IS NOT NULL`; a thin `bot_profiles` side-table keyed by `player_id` (Data Model §3).
- **The match envelope.** A `matches` table carrying `mode`, terminal `status`/`resolution_reason`, timestamps, and the always-present `variant_snapshot` (+ nullable `variant_id`/`variant_version`, derived `variant_hash`) that makes each record self-describing (Data Model §4, §5).
- **Seats.** A `match_participants` row per seat — `player_id`, `seat_index`, `team`, `outcome`, `final_score`, `is_abandoner` (Data Model §5).
- **Scorecard (parent/child).** `match_hands` (per-hand: `hand_number`, `bidder_seat`, `contract_value`, `trump`, `made`) and `match_hand_lines` (per-side: `side`, `meld`, `counters`, `total`, `cumulative`) — split so the grain is correct for free-for-all Cutthroat (N sides), not only 2-side Partners (Data Model §5, refined 2026-06-27).
- **A pure hand projector.** A pure `(HandResult, Contract, trump, ScorePad) → { hand, lines }` function co-located with the schema, mapping engine values to the scorecard rows **as-scored** (post meld-needs-a-trick gate and set-penalty override). Depends only on engine types, so it is unit-testable before the room-writer exists.
- **Replays (opaque storage).** A `match_replays` table holding `data` (`bytea`), `schema_version`, and `format` **opaquely** — the intent-log serialization, its recording, and the meaning of those values are owned by the Match Runtime writer, not this layer (Data Model §5).
- **Abandon-event substrate.** An append-only `abandon_events` table (`player_id`, `match_id`, `kind`, `occurred_at`) for the leaver-penalty layer to read; the room already emits the signal (Data Model §7).
- **Schema home retires its emptiness.** The `data-persistence` "empty schema home" requirement is superseded now that domain tables live there.

## Capabilities

### New Capabilities

- `match-record-store`: the durable match-record tables — `players` + `bot_profiles`, `matches` (with the variant snapshot columns), `match_participants`, `match_hands` + `match_hand_lines`, `match_replays` (opaque), and `abandon_events` — their columns, keys, and integrity constraints; the pure as-scored hand projector; and a generated migration that applies cleanly. Storage shapes and the projector only — not the room-writer that fills them.

### Modified Capabilities

- `data-persistence`: the "Empty schema home" requirement is retired — the Drizzle schema module now hosts domain tables (the match-record family). The client/migration-tooling requirements are unchanged.

## Impact

- **Code:** `packages/shared/src/server/db/` — the previously-empty `schema.ts` gains the match-record table definitions (likely split into per-area modules re-exported from `schema.ts` so `drizzle.config.ts` and `createDb` need no rewiring); a new co-located pure projector module (engine→scorecard rows) with Vitest coverage. The generated migration lands under `./drizzle`.
- **Dependencies:** none new — `drizzle-orm`, `drizzle-kit`, and `@neondatabase/serverless` are already present; the projector imports types from `@meldrank/engine` and `@meldrank/shared`.
- **Consumers (not built here):** the Match Runtime room-writer ("slice #6") that performs the same-transaction write on `Complete`; the `apps/api` read path for match history. Both build against these tables later.
- **Out of scope:** the room-as-writer and result emission (Match Runtime); the replay intent-log format/recording; ratings, moderation/chat, and notifications tables (later writer-readiness slices, Data Model §13); object-storage replays (`storage_url` seam, §5).
