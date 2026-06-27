## Context

The `data-persistence` change established the durable plumbing — a Drizzle-over-Neon client on the server-only surface (`@meldrank/shared/server`), drizzle-kit migration scripts, and an intentionally-empty schema home at `packages/shared/src/server/db/schema.ts` (targeted by both `drizzle.config.ts` and `createDb`). No domain tables exist yet.

This change fills that home with the **match record** — the first writer-readiness slice of "Data Model — Design v1" (§13). Per the design's standing constraints: the room is the only writer of match records (this slice does **not** build that writer), records are self-describing (each carries its own variant snapshot + a replay), and identity is mirrored from Clerk. The match room (`apps/match`) already produces the values this layer must store — `HandResult`/`ScorePad` from `@meldrank/engine`, per-seat `MatchStanding` outcomes, and a terminal `ResolutionState` it carries into its inert `Complete → Persisted` run-out.

## Goals / Non-Goals

**Goals:**

- Define the durable match-record tables (`players`, `bot_profiles`, `matches`, `match_participants`, `match_hands`, `match_hand_lines`, `match_replays`, `abandon_events`) with their columns, keys, and integrity constraints.
- Ship a **pure, unit-testable hand projector** that turns the engine's as-scored hand values into scorecard rows — giving this slice a behavioral test surface before the room-writer exists.
- Store replays **opaquely** (bytes + metadata), reserving the documented object-storage seam.
- Generate one migration that applies cleanly, and retire the now-false "empty schema home" requirement.

**Non-Goals:**

- The room-as-writer / same-transaction write on `Complete` (Match Runtime, the downstream "slice #6") and the result/reveal payload emission.
- The replay intent-log **serialization format** and its recording — owned by the writer; this layer treats `data`/`schema_version`/`format` as opaque.
- `variant_hash` and `variant_snapshot` **production** — the producer computes them; this layer only stores them.
- Ratings, moderation/chat, and notifications tables (later writer-readiness slices, Data Model §13).
- Repository/query helpers and the `apps/api` read path (built with their consumers).

## Decisions

### D1 — Schema split into per-area modules, re-exported from `schema.ts`

Keep `schema.ts` as the single Drizzle entry point (no rewiring of `drizzle.config.ts`/`createDb`), but define tables in focused modules under `packages/shared/src/server/db/schema/` (`players.ts`, `matches.ts`, `hands.ts`, `replays.ts`, `abandon.ts`) that `schema.ts` re-exports. Rationale: the match record is ~8 tables and more table families land in later slices; one growing file becomes unreadable. Alternative (one flat `schema.ts`) rejected — it doesn't scale across the planned slices.

### D2 — `match_hands` + `match_hand_lines` (parent/child grain)

A hand has one bidding context but **N side-results** (Partners = 2, free-for-all Cutthroat = up to 4). `match_hands` holds the per-hand envelope; `match_hand_lines` holds one row per side. Alternatives rejected: fixed two-side columns (wrong for free-for-all), and a per-hand `lines` jsonb (semi-structured — undercuts the queryable-scorecard goal that justifies this carve-out). Settled with Jason 2026-06-27 (Data Model §5).

### D3 — Per-side values stored **as-scored**

`match_hand_lines.meld`/`counters`/`total` are the engine's post-processing values — after the meld-needs-a-trick gate and the set-penalty override — matching `ScorePad`/`HandScoreLine`. `cumulative` is the running per-side score after the hand (`ScorePad.cumulative`). Raw pre-gate tallies, if ever needed, are recoverable from the replay; storing both was rejected as premature.

### D4 — Pure projector takes a **plain structural input**, not engine types

`engine` depends on `shared` (confirmed: `@meldrank/engine` lists `@meldrank/shared`), so `shared` **cannot** import `engine` without a dependency cycle. The projector lives with the schema (`packages/shared/src/server/db/`) and therefore accepts a **plain value object**, not `HandResult`/`ScorePad`:

```
projectHand(input): { hand: MatchHandInsert; lines: MatchHandLineInsert[] }
  input = {
    handNumber, bidderSeat, contractValue, trump, made,
    lines: Array<{ side; meld; counters; total }>,   // as-scored, from HandResult.lines
    cumulativeBySide: Record<number, number>,         // from ScorePad.cumulative
  }
```

The real, testable logic — joining each side's line to its cumulative-after, ordering by side id, and shaping into Drizzle `$inferInsert` rows — runs over plain data and needs no engine import. The future writer does the trivial field-extraction from engine objects into this input. This both breaks the cycle and decouples the durable layer from engine internals. Alternative (projector in `packages/engine` importing DB row types) rejected: it leaks persistence shapes into the zero-dependency pure engine.

### D5 — `match_replays` is opaque storage

`data bytea`, `schema_version`, `format` are stored and returned verbatim; no SQL ever inspects them. The PK is `match_id` (FK → `matches`), enforcing one-replay-per-match. The same-transaction write guarantee (envelope + replay land together) is the **writer's** obligation; at this layer the FK + PK make an orphaned blob or a dangling pointer unrepresentable. The object-storage `storage_url` seam (Data Model §5) is documented, not built.

### D6 — `players`: unified table, enum `type`, partial-unique + check constraint

One table for humans and bots, `type` enum (`human`/`bot`). `clerk_user_id` is nullable (bots have none) and **uniquely** indexed where present (partial unique index, so multiple bot nulls coexist). A check constraint binds `type='human'` ⟺ `clerk_user_id IS NOT NULL`. `bot_profiles` is a thin side-table keyed by `player_id` with `difficulty` + a `params` jsonb seam. `status` enum is `active`/`anonymized`/`banned` (supports the anonymize-not-delete lifecycle, Data Model §10).

### D7 — Closed value sets as Postgres enums; `outcome` split from `placement`

Closed sets become `pgEnum`s: `player_type`, `player_status`, `match_mode` (`ranked`/`casual`), `match_status` (`complete`/`aborted`), `resolution_reason` (`played_out`/`forfeit_abandon`/`timeout_abandon`/`aborted`), `abandon_kind` (`forfeit_abandon`/`timeout_abandon`).

**Enum vocabularies mirror the writer (the room), not the doc's prose.** The room is the only writer of these columns, so each closed set is reconciled against what the room actually emits today, since widening a `pgEnum` later is an `ALTER TYPE` migration:

- `resolution_reason` mirrors the room's `ResolutionReason` (`apps/match/src/room/types.ts`): `forfeit_abandon` / `timeout_abandon` / `aborted` (the mid-match multi-drop/crash abort), **plus** `played_out` for the not-yet-built played-out completion path. The proposal's earlier `aborted_no_fill` was a naming/semantic divergence from the room and is dropped in favor of the room's `aborted` (settled with Jason 2026-06-27).
- `participant_outcome` is `win` / `loss` / `no_result`. The engine's played-out path emits `MatchStanding.outcome: win|loss`; the room's forfeit/abort path emits a richer `SeatOutcomeLabel` (`abandoner_loss` / `stranded_partner_reduced_loss` / `opponent_win` / `no_result`). The writer **normalizes** the room labels into the canonical durable set — `opponent_win → win`, `abandoner_loss` and `stranded_partner_reduced_loss → loss`, `no_result → no_result` — while the abandoner is flagged by `is_abandoner` and the stranded-vs-opponent nuance stays recoverable from `is_abandoner` + `team` + `resolution_reason`. `no_result` is required so an aborted match's participant rows (nobody charged) are representable; `win|loss` alone could not express them (settled with Jason 2026-06-27).

For `match_participants`, the Data Model doc lumps `outcome` as `win | loss | placement(1/2/3)`; the engine's `MatchStanding` carries **both** an `outcome: win|loss` and an integer `placement`. We store them as **separate columns** — `outcome` enum (above) + nullable `placement` smallint — so placement variants keep a win/loss verdict and the integer rank without overloading one field. This refines the doc's phrasing (flagged for the design-of-record). `match_participants.team` is a nullable smallint (partnership id; null for free-for-all). UUID PKs default to `gen_random_uuid()`.

### D8 — Test surface without a writer

Verification is honest about the missing writer: (1) the generated migration applies to a clean database; (2) every table round-trips a representative row, with the `players` check constraint and partial-unique index proven by rejection cases; (3) `match_replays` round-trips arbitrary bytes and rejects a blob whose `match_id` has no match; (4) the projector is exhaustively unit-tested over plain inputs (Partners 2-side and free-for-all N-side, made and set hands, gate/penalty already reflected in inputs) with **no database**. A real end-to-end replay round-trip waits for the writer slice.

## Risks / Trade-offs

- **Dead tables until writers exist** → Accepted and bounded: this slice's tables (`players`…`abandon_events`) all have a near-term writer (Match Runtime slice #6) or read path (API history); the genuinely writer-less families (ratings/moderation/notifications) are explicitly deferred to their own slices, so nothing dead ships here.
- **Projector input duplicates a slice of engine shape** → The plain input mirrors `HandScoreLine` (`{side, meld, counters, total}`) plus a cumulative map. This minor duplication is the price of keeping `shared` free of an `engine` dependency; it also insulates the durable layer from engine refactors.
- **`pgEnum` growth needs migrations** → Adding an enum value later is an `ALTER TYPE` migration. Acceptable for these closed, slow-changing sets; the win is DB-enforced integrity over free-text + check.
- **Splitting `outcome`/`placement` diverges from the doc's wording** → Mitigated by flagging it as a refinement; it matches what the engine actually emits (`MatchStanding`), avoiding a lossy single field.
- **Migration is effectively irreversible forward-only** → drizzle-kit migrations are additive; rollback in dev is drop-and-regenerate. No production data exists yet, so the risk window is nil.

## Migration Plan

1. Add the per-area schema modules and re-export them from `schema.ts`; add the projector module + tests.
2. `pnpm db:generate` to produce the migration under `./drizzle`; review the SQL (enum creation, tables, the partial-unique index, the check constraint, FKs).
3. `pnpm db:migrate` against a configured database to confirm clean application; exercise the round-trip and constraint-rejection tests.
4. Rollback (dev only): drop the schema / regenerate — no production data to preserve.

## Open Questions

- None blocking. Index coverage beyond keys (e.g. `matches(completed_at)` for history reads, `abandon_events(player_id)` for the penalty layer) can be added here or deferred to the read-path consumer; default is to add the obvious history/lookup indexes now and let consumers add their own.
