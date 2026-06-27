## 1. Schema module scaffolding

- [x] 1.1 Create `packages/shared/src/server/db/schema/` and re-export all modules from the existing `schema.ts` (replace the empty `export {}`), so `drizzle.config.ts` and `createDb` need no rewiring
- [x] 1.2 Define the shared `pgEnum`s: `player_type`, `player_status`, `match_mode`, `match_status`, `resolution_reason` (`played_out`/`forfeit_abandon`/`timeout_abandon`/`aborted` — mirrors the room), `participant_outcome` (`win`/`loss`/`no_result`), `abandon_kind`

## 2. Players & identity

- [x] 2.1 Define the `players` table (uuid PK, `type`, nullable `clerk_user_id`, `display_name`, `avatar`, `status`, timestamps) with the `type='human'` ⟺ `clerk_user_id IS NOT NULL` check constraint and a partial-unique index on `clerk_user_id`
- [x] 2.2 Define the `bot_profiles` side-table keyed by `player_id` (`difficulty`, `params` jsonb)

## 3. Match envelope & participants

- [x] 3.1 Define the `matches` table (uuid PK, `mode`, `status`, `resolution_reason`, timestamps) with the variant columns: nullable `variant_id`/`variant_version`, always-present `variant_snapshot` jsonb, `variant_hash`
- [x] 3.2 Define the `match_participants` table (PK, FKs to `matches`/`players`, `seat_index`, nullable `team`, `outcome` enum, nullable `placement`, `final_score`, `is_abandoner`)

## 4. Scorecard & replay

- [x] 4.1 Define the `match_hands` table (PK, FK to `matches`, `hand_number`, `bidder_seat`, `contract_value`, `trump`, `made`)
- [x] 4.2 Define the `match_hand_lines` table (FK to `match_hands`, `side`, `meld`, `counters`, `total`, `cumulative`)
- [x] 4.3 Define the `match_replays` table (`match_id` PK + FK, `data` bytea, `schema_version`, `format`)

## 5. Abandon substrate

- [x] 5.1 Define the append-only `abandon_events` table (PK, FKs to `players`/`matches`, `kind` enum, `occurred_at`)

## 6. Pure hand projector

- [x] 6.1 Define the plain projector input type and the `MatchHandInsert`/`MatchHandLineInsert` row types (Drizzle `$inferInsert`) in the db module
- [x] 6.2 Implement the pure `projectHand(input) → { hand, lines }` projector — join each side line to its cumulative, order line rows by side id; no engine import, no database
- [x] 6.3 Unit-test the projector: made Partners hand, set hand (as-scored penalty preserved), free-for-all 4-side hand, deterministic side ordering

## 7. Migration & DB round-trip verification

- [x] 7.1 Run `pnpm db:generate`; review the generated SQL (enum creation, tables, partial-unique index, check constraint, FKs) and confirm it applies via `pnpm db:migrate` against a configured database
- [x] 7.2 Add DB round-trip / constraint tests: `players` check-constraint rejections + unique/null coexistence; `matches` casual-vs-ranked variant columns; participant placement; hands with 2 and 4 side lines; `match_replays` byte round-trip, dangling-FK rejection, duplicate-PK rejection; `abandon_events` insert

## 8. Validation

- [x] 8.1 Use the validate agent to run lint, typecheck, and test across the workspace and confirm a clean result
