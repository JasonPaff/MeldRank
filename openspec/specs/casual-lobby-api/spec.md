# casual-lobby-api Specification

## Purpose

Defines the casual-lobby tRPC procedures that create and manage ephemeral, Redis-backed casual tables — seating humans and bots, listing open tables, spawning a room when a table fills, and minting per-seat tickets — plus the reconnect lookup for a caller's active match.

## Requirements

### Requirement: Create a casual table backed by ephemeral Redis state

The API SHALL expose `casual.createTable({ variantId })`, which resolves the variant, creates a casual-table record in Redis with the caller seated and the remaining seats empty, sets status `open`, indexes it for listing, and returns the table. Table state SHALL be ephemeral (Redis, with a TTL) — no Postgres row is written. An unknown variant SHALL be rejected with a typed `not-found` error.

#### Scenario: Creating a table seats the creator and opens it

- **WHEN** `casual.createTable` is called with a known variant
- **THEN** a Redis casual-table record is created with the caller in one seat, the other seats empty, and status `open`
- **AND** the table appears in `casual.listOpenTables`

#### Scenario: Creating a table with an unknown variant is rejected

- **WHEN** `casual.createTable` is called with an unknown variant id
- **THEN** it rejects with a typed `not-found` error and creates no table

### Requirement: List open casual tables

The API SHALL expose `casual.listOpenTables`, returning the casual tables currently in status `open` as a cursor-paginated result using the shared pagination envelope.

#### Scenario: Only open tables are listed

- **WHEN** `casual.listOpenTables` is called
- **THEN** it returns tables in status `open` in the shared `{ items, nextCursor }` envelope
- **AND** tables in status `spawning` or `live` are not listed

### Requirement: Join and leave a casual seat with race-safe occupancy

The API SHALL expose `casual.joinSeat({ tableId, seat })` and `casual.leaveTable({ tableId })`. A join SHALL atomically claim the target seat only if it is empty, rejecting with a typed `conflict` error when the seat is already taken and a typed `not-found` error when the table does not exist. Leaving SHALL free the caller's seat; a table left with no human occupants MAY be evicted.

#### Scenario: Joining an empty seat claims it

- **WHEN** `casual.joinSeat` targets an empty seat on an open table
- **THEN** the caller is recorded in that seat and the updated table reflects the occupancy

#### Scenario: Joining an occupied seat is rejected without overwriting

- **WHEN** two joiners target the same empty seat concurrently
- **THEN** at most one succeeds and the other receives a typed `conflict` error
- **AND** the seat's occupant is never overwritten

#### Scenario: Leaving frees the seat

- **WHEN** `casual.leaveTable` is called by a seated caller
- **THEN** that caller's seat becomes empty in the table record

### Requirement: Add a bot to a casual seat

The API SHALL expose `casual.addBot({ tableId, seat, difficulty })`, which atomically fills an empty seat with a bot marker. The `difficulty` field SHALL be accepted in the contract; in this slice the seated bot is the random-legal brain regardless of the requested difficulty. Bots SHALL only be added to casual tables.

#### Scenario: Adding a bot fills an empty seat

- **WHEN** `casual.addBot` targets an empty seat
- **THEN** that seat is marked as a bot occupant in the table record

#### Scenario: difficulty is accepted but does not change skeleton behavior

- **WHEN** `casual.addBot` is called with any `difficulty`
- **THEN** the request is accepted and the seated bot is the random-legal brain

### Requirement: A full table spawns a room and mints each human seat's ticket

When a casual table's seats are all occupied (humans and/or bots), the API SHALL transition it `open → spawning`, request a room from the match service (frozen variant + seating assignment + bot count), and on a returned room handle mint a signed seat ticket for each human seat and transition the table to `live`. If spawn fails, the table SHALL roll back to `open` (or evict) and the caller SHALL receive a typed error; no human seat ticket is issued without a spawned room.

#### Scenario: Filling the last seat triggers spawn and ticket minting

- **WHEN** the action that fills a table's final seat completes
- **THEN** the API requests a room with the frozen variant, the per-seat seating assignment, and the bot count
- **AND** on a returned room handle it mints a seat ticket for each human seat and sets the table `live`

#### Scenario: Spawn failure rolls the table back

- **WHEN** the room-spawn request fails for a full table
- **THEN** the table returns to `open` (or is evicted) and no seat ticket is minted
- **AND** the caller receives a typed error

### Requirement: quickPlay creates a fresh bot-filled casual table

The API SHALL expose `casual.quickPlay`, which creates a new casual table on the default variant (Single-Deck Partners), seats the caller, fills the remaining seats with bots so the table is immediately full, spawns the room, and returns the caller's seat ticket. This is the one-call path to a self-playing skeleton match. Selecting and joining an existing open table is out of scope for this slice — `quickPlay` always creates.

#### Scenario: quickPlay returns a seat ticket for an immediately full table

- **WHEN** `casual.quickPlay` is called
- **THEN** a new table is created on the default variant with the caller seated and the remaining seats bot-filled
- **AND** the room spawns and the caller's seat ticket is returned

#### Scenario: quickPlay does not join an existing open table

- **WHEN** `casual.quickPlay` is called while compatible open tables already exist
- **THEN** it still creates a fresh table rather than joining an existing one

### Requirement: match.getActive returns the caller's reconnectable match

The API SHALL expose `match.getActive`, returning the caller's currently live match (room handle + seat) when one exists, so a client can rejoin, or an empty result when the caller is in no live match.

#### Scenario: Active match is returned for a seated caller

- **WHEN** `match.getActive` is called by a caller currently in a `live` table
- **THEN** it returns that match's room handle and the caller's seat

#### Scenario: No active match returns empty

- **WHEN** `match.getActive` is called by a caller in no live match
- **THEN** it returns an empty result
