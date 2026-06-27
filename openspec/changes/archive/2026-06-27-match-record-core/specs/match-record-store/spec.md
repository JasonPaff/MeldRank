## ADDED Requirements

### Requirement: Players and bot profiles

The schema SHALL define a single `players` table for both humans and bots, discriminated by a `type` enum (`human` | `bot`). It SHALL carry a nullable `clerk_user_id`, a `display_name`, an `avatar`, a `status` enum (`active` | `anonymized` | `banned`), and created/updated timestamps. A human SHALL always carry a Clerk id and a bot SHALL never carry one, enforced by a check constraint binding `type='human'` ⟺ `clerk_user_id IS NOT NULL`. Where present, `clerk_user_id` SHALL be unique. The schema SHALL define a `bot_profiles` side-table keyed by `player_id` carrying a `difficulty` and a `params` jsonb seam.

#### Scenario: Human requires a Clerk id

- **WHEN** a row with `type='human'` and a null `clerk_user_id` is inserted
- **THEN** the check constraint rejects the insert

#### Scenario: Bot rejects a Clerk id

- **WHEN** a row with `type='bot'` and a non-null `clerk_user_id` is inserted
- **THEN** the check constraint rejects the insert

#### Scenario: Clerk ids are unique but nulls coexist

- **WHEN** two bot rows (both null `clerk_user_id`) are inserted, then two human rows share one `clerk_user_id`
- **THEN** the two bot rows succeed and the duplicate human `clerk_user_id` is rejected by the unique index

### Requirement: Match envelope with self-describing variant snapshot

The schema SHALL define a `matches` table carrying `id` (uuid PK), `mode` (`ranked` | `casual`), `status` (`complete` | `aborted`), `resolution_reason` (`played_out` | `forfeit_abandon` | `timeout_abandon` | `aborted`), and started/completed/created timestamps. The `resolution_reason` values mirror the room's emitted `ResolutionReason` (the only writer) plus `played_out` for the played-out completion path. Every match SHALL carry an always-present `variant_snapshot` (jsonb) and a derived `variant_hash`, plus a nullable `variant_id` and nullable `variant_version` (set for ranked, null for ad-hoc casual). The snapshot and hash SHALL be stored as provided by the producer; this layer does not compute or validate them.

#### Scenario: Casual match without a variant reference

- **WHEN** a casual match is inserted with null `variant_id`/`variant_version` but a present `variant_snapshot` and `variant_hash`
- **THEN** the insert succeeds and the row is self-describing from its snapshot alone

#### Scenario: Ranked match carries its reference and snapshot

- **WHEN** a ranked match is inserted with `variant_id`, `variant_version`, `variant_snapshot`, and `variant_hash`
- **THEN** the insert succeeds and all variant columns round-trip unchanged

### Requirement: Match participants

The schema SHALL define a `match_participants` table with one row per seat, carrying `id` (PK), `match_id` (FK → `matches`), `player_id` (FK → `players`), `seat_index`, a nullable `team` (partnership id; null for free-for-all), an `outcome` enum (`win` | `loss` | `no_result`), a nullable integer `placement`, a `final_score`, and an `is_abandoner` flag. The `outcome` set is the canonical durable normalization of what the room emits: the engine's played-out `win`/`loss`, plus `no_result` for an aborted match (nobody charged). The room's forfeit labels normalize into it (`opponent_win → win`, `abandoner_loss`/`stranded_partner_reduced_loss → loss`), with the abandoner identified by `is_abandoner`.

#### Scenario: Partners seat references match and player

- **WHEN** a participant row is inserted referencing an existing match and player with a `team` and `outcome`
- **THEN** the insert succeeds and both foreign keys resolve

#### Scenario: Free-for-all seat records a placement

- **WHEN** a participant row for a placement variant is inserted with null `team`, `outcome='loss'`, and `placement=3`
- **THEN** the insert succeeds, preserving both the win/loss verdict and the integer rank

#### Scenario: Aborted-match seat records no result

- **WHEN** a participant row of an aborted match is inserted with `outcome='no_result'` and a null `placement`
- **THEN** the insert succeeds, representing a seat that was neither won nor lost (nobody charged)

### Requirement: Scorecard hands and per-side lines

The schema SHALL define a `match_hands` table (one row per hand) carrying `id` (PK), `match_id` (FK → `matches`), `hand_number`, `bidder_seat`, `contract_value`, `trump`, and a `made` boolean; and a `match_hand_lines` table (one row per side per hand) carrying `match_hand_id` (FK → `match_hands`), `side`, `meld`, `counters`, `total`, and `cumulative`. The grain SHALL support an arbitrary number of sides per hand (two for Partners, up to four for free-for-all).

#### Scenario: A Partners hand stores two side lines

- **WHEN** a hand with two side lines is inserted
- **THEN** the hand row and exactly two `match_hand_lines` rows persist and resolve to that hand

#### Scenario: A free-for-all hand stores four side lines

- **WHEN** a hand with four side lines is inserted
- **THEN** all four `match_hand_lines` rows persist against the single hand row

### Requirement: Pure as-scored hand projector

The schema package SHALL ship a pure projector function that maps a plain hand-result input — hand number, bidder seat, contract value, trump, made verdict, the per-side as-scored lines (`side`, `meld`, `counters`, `total`), and a per-side cumulative map — to one `match_hands` insert row and the corresponding `match_hand_lines` insert rows. The projector SHALL NOT import the engine package and SHALL NOT require a database; it SHALL join each side's line to its cumulative score and order the line rows deterministically by side id.

#### Scenario: Projects a made Partners hand to rows

- **WHEN** the projector is given a made hand with two as-scored side lines and a cumulative map
- **THEN** it returns one hand row (with `made=true`) and two line rows, each carrying its side's `meld`/`counters`/`total` and matching `cumulative`, ordered by side id

#### Scenario: Projects a set hand preserving the as-scored penalty

- **WHEN** the projector is given a set hand whose bidding side's input line already reflects the set-penalty override
- **THEN** the returned bidding-side line row carries those as-scored values unchanged and the hand row has `made=false`

#### Scenario: Projects a free-for-all hand with N sides

- **WHEN** the projector is given a hand with four as-scored side lines
- **THEN** it returns four line rows, one per side, each joined to its cumulative score

### Requirement: Opaque replay storage

The schema SHALL define a `match_replays` table keyed by `match_id` (PK, FK → `matches`) carrying `data` (`bytea`), `schema_version`, and `format`. These columns SHALL be stored and returned verbatim; this layer SHALL NOT inspect, parse, or validate the replay contents or the meaning of `schema_version`/`format` — those are owned by the replay format/writer. The one-replay-per-match relationship SHALL be enforced by the primary key, and a replay SHALL NOT exist without its match.

#### Scenario: Arbitrary bytes round-trip

- **WHEN** a replay row with arbitrary `data` bytes, a `schema_version`, and a `format` is inserted and read back
- **THEN** the bytes and metadata are returned byte-for-byte unchanged

#### Scenario: A replay cannot dangle

- **WHEN** a replay row is inserted whose `match_id` references no existing match
- **THEN** the foreign key rejects the insert

#### Scenario: One replay per match

- **WHEN** a second replay row is inserted for a `match_id` that already has one
- **THEN** the primary key rejects the duplicate

### Requirement: Append-only abandon events

The schema SHALL define an `abandon_events` table carrying `id` (PK), `player_id` (FK → `players`), `match_id` (FK → `matches`), a `kind` enum (`forfeit_abandon` | `timeout_abandon`), and an `occurred_at` timestamp, providing the substrate the leaver-penalty layer reads. The table SHALL be treated as append-only.

#### Scenario: An abandon event is recorded against a player and match

- **WHEN** an abandon event with a `kind` and `occurred_at` is inserted referencing an existing player and match
- **THEN** the insert succeeds and both foreign keys resolve

### Requirement: Schema home wiring is unchanged

The match-record tables SHALL be reachable through the existing Drizzle schema module (`packages/shared/src/server/db/schema.ts`) so that `drizzle.config.ts` and the `createDb` client require no rewiring, and a generated migration SHALL apply cleanly to a fresh database.

#### Scenario: Migration applies to a clean database

- **WHEN** the generated migration is applied to an empty database
- **THEN** every match-record table, enum, index, and constraint is created without error

#### Scenario: Tables are exported from the schema entry point

- **WHEN** the Drizzle schema module is inspected
- **THEN** it exposes the match-record tables (directly or via re-export), and the existing client/config targets resolve them without configuration changes
