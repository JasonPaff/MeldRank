## ADDED Requirements

### Requirement: Browse open casual tables

The web client SHALL provide a hall surface that lists the currently open casual
tables by polling `casual.listOpenTables`, rendering for each table its variant, its
seat occupancy (how many seats are filled and by humans vs. bots), and an affordance to
open it. The list SHALL refresh on an interval so newly created tables appear and
filled tables drop off without a manual reload. While the first page is pending it SHALL
render a loading state, on error a retryable error state, and when no tables are open an
explicit empty state alongside the create/Quick Play entry points.

#### Scenario: Open tables are listed and refresh

- **WHEN** the hall surface is shown and `casual.listOpenTables` returns one or more open tables
- **THEN** each table is rendered with its variant and seat occupancy and an affordance to open it
- **AND** the list re-queries on an interval so a table that fills disappears and a newly created table appears

#### Scenario: Empty, pending, and error states

- **WHEN** `casual.listOpenTables` is pending, errors, or returns no open tables
- **THEN** the hall renders a loading, retryable-error, or empty state respectively
- **AND** the create-table and Quick Play entry points remain available

### Requirement: Create a casual table

The hall SHALL expose a create-table action that calls `casual.createTable` on the
default variant (Single-Deck Partners), and on success SHALL navigate the creator into
the waiting room for the returned table. The action SHALL show a pending state while the
mutation is in flight so it cannot be double-submitted, and SHALL surface a retryable
error without navigating when creation fails.

#### Scenario: Create navigates the creator into the waiting room

- **WHEN** the create-table action succeeds
- **THEN** the client navigates to the waiting room keyed by the returned table's id
- **AND** the creator is shown seated in their seat

#### Scenario: Create failure surfaces without navigating

- **WHEN** `casual.createTable` fails
- **THEN** a retryable error is shown and the client does not navigate

### Requirement: Waiting room renders live seat occupancy

The web client SHALL provide a waiting-room route keyed by `tableId` that polls
`casual.getTable` and renders the table's seats with their current occupancy (empty,
the seated human, or a bot), refreshing on an interval so the caller sees seats fill in
near-real time. If `casual.getTable` returns not-found (the table was evicted), the
waiting room SHALL return the caller to the hall rather than render a dead table.

#### Scenario: Seats populate as players join

- **WHEN** the waiting room is shown for a `Filling` table and another player or bot claims a seat
- **THEN** a subsequent poll of `casual.getTable` reflects the new occupancy
- **AND** the rendered seats update to show who occupies each seat

#### Scenario: An evicted table returns the caller to the hall

- **WHEN** a `casual.getTable` poll for the waiting room returns not-found
- **THEN** the caller is returned to the hall surface

### Requirement: Waiting room seat actions

From the waiting room the caller SHALL be able to claim a specific empty seat
(`casual.joinSeat`), drop a bot into a specific empty seat (`casual.addBot`), and leave
the table (`casual.leaveTable`). A seat action SHALL show a pending state while in
flight. A `conflict` error (a seat claimed concurrently) SHALL be surfaced as a
non-fatal "seat just taken" message and the table view refreshed rather than treated as
a hard failure. Leaving the table SHALL return the caller to the hall surface.

#### Scenario: Claim a specific empty seat

- **WHEN** the caller chooses an empty seat and `casual.joinSeat` succeeds for that seat
- **THEN** the caller is shown occupying that seat in the refreshed table view

#### Scenario: Add a bot to a specific empty seat

- **WHEN** the caller adds a bot to an empty seat and `casual.addBot` succeeds
- **THEN** that seat is shown occupied by a bot in the refreshed table view

#### Scenario: A concurrently taken seat is non-fatal

- **WHEN** a seat action returns a `conflict` error
- **THEN** a non-fatal "seat just taken" message is shown and the table view is refreshed

#### Scenario: Leaving returns to the hall

- **WHEN** the caller leaves the table and `casual.leaveTable` succeeds
- **THEN** the caller is returned to the hall surface

### Requirement: Transition to live hands off to the play route

The waiting room SHALL detect when its table has spawned a room (a `casual.getTable`
poll reporting status `live` with a `roomId`) and, on that signal, SHALL fetch the
caller's seat ticket via `match.getActive`, stash the returned ticket and match handle
into the F0 session store, and navigate to the existing play route (`/table/[roomId]`)
for a warm join. The caller SHALL reach the live table without any manual action.

#### Scenario: A spawned table hands the caller off to the play route

- **WHEN** the waiting room sees `casual.getTable` report `live` with a `roomId`
- **AND** `match.getActive` returns the caller's match handle and seat ticket
- **THEN** the client stashes the ticket and handle and navigates to `/table/[roomId]`

#### Scenario: A transient spawning poll keeps waiting

- **WHEN** a `casual.getTable` poll reports a non-live status (e.g. `spawning`) with no `roomId`
- **THEN** the waiting room remains in place and keeps polling rather than navigating
