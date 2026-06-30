## ADDED Requirements

### Requirement: Read a single casual table by id

The API SHALL expose `casual.getTable({ tableId })`, returning the current ephemeral
casual-table record (seats, occupancy, status, and `roomId` when spawned) for the given
id, so a client can poll a table's `Filling` state and detect its transition to `live`.
An unknown or evicted table SHALL be rejected with a typed `not-found` error. The read
SHALL NOT mutate table state.

#### Scenario: A known table is returned

- **WHEN** `casual.getTable` is called with the id of an existing casual table
- **THEN** it returns that table's current record including its seats, status, and `roomId` (if spawned)

#### Scenario: An unknown table is rejected

- **WHEN** `casual.getTable` is called with an id that no longer exists
- **THEN** it is rejected with a typed `not-found` error

## MODIFIED Requirements

### Requirement: match.getActive returns the caller's reconnectable match

The API SHALL expose `match.getActive`, returning the caller's currently live match
(room handle + seat) when one exists, so a client can rejoin, or an empty result when
the caller is in no live match. When a live match is returned, the API SHALL also mint a
fresh signed seat ticket for the caller's seat (via the same seat-ticket minter used at
spawn) and include it in the result, so any seated human — not only the caller who
filled the last seat — can obtain a valid entry credential for a warm join. Minting is
stateless; each call returns an independently valid ticket with a fresh expiry.

#### Scenario: Active match is returned with a fresh seat ticket

- **WHEN** `match.getActive` is called by a caller currently in a `live` table
- **THEN** it returns that match's room handle, the caller's seat, and a freshly minted signed seat ticket for that seat

#### Scenario: The returned ticket verifies for the caller's seat

- **WHEN** the seat ticket returned by `match.getActive` is verified with the shared secret before its expiry
- **THEN** it resolves to the caller's room, seat, and player id

#### Scenario: No active match returns empty

- **WHEN** `match.getActive` is called by a caller in no live match
- **THEN** it returns an empty result and no seat ticket
