# table-play-web Specification

## Purpose

Defines the web client's table-play surface: the table route that joins the
lobby-spawned Colyseus match room with the stashed seat ticket, renders the
authoritative per-seat filtered view, drives the human intent loop with
pessimistic reconciliation, contributes a best-effort per-hand seed, and plays a
1-human + 3-bot Single-Deck Partners game through to its terminal states.

## Requirements

### Requirement: Join the spawned room with the lobby's seat ticket

The `apps/web` table route SHALL connect to the spawned Colyseus match room using the
seat ticket and active-match handle the lobby stashed in the session store, presenting the
ticket as join options so the match service's `onAuth` binds the reserved seat. All room
connection logic SHALL run under the client boundary (never during SSR).

#### Scenario: Warm handoff joins the reserved seat

- **WHEN** the table route mounts with a `seatTicket` and `activeMatch` handle present in
  the session store
- **THEN** the client calls `joinById(roomId, { ticket })` against the configured Colyseus
  client and, on success, transitions to a connected/rendering state bound to the seat the
  ticket reserves

#### Scenario: Rejected ticket surfaces an error, not a crash

- **WHEN** the join is rejected by the room's `onAuth` (missing, invalid, or expired
  ticket)
- **THEN** the route renders an error state with a return-to-lobby affordance and joins no
  room

#### Scenario: Cold load without a ticket cannot rejoin

- **WHEN** the table route mounts with no `seatTicket` in the session store (e.g. a hard
  refresh)
- **THEN** the route renders a return-to-lobby affordance rather than attempting to connect

### Requirement: Render the per-seat filtered view

The table SHALL render game state exclusively from the authoritative per-seat
`FilteredView` delivered over room messages plus the auto-synced presence metadata, and
SHALL never render or request hidden information. It SHALL show the viewer's own hand, the
table-visible public state (auction standing, contract/trump, current and completed
tricks, revealed widow, scores), and every opponent as a count of face-down cards.

#### Scenario: Own hand and public state render from the view

- **WHEN** a `view` (or `accept`/`reject` carrying a view) message arrives
- **THEN** the held render model is replaced wholesale with that `FilteredView` and the UI
  reflects the viewer's `own.hand` and the `public` table state

#### Scenario: Opponents render as card-backs only

- **WHEN** the view is rendered
- **THEN** each non-viewer seat is shown as `handSizes[seat]` face-down cards with no card
  identity, because the view carries no other seat's contents

#### Scenario: Whose-turn and seat status come from synced metadata

- **WHEN** the synced `RoomMetadata` updates (`seatToAct`, `lifecycle`, `seatStatus`)
- **THEN** the table reflects which seat is on the clock and each seat's connection status
  (connected / disconnected / bot-controlled / empty)

### Requirement: Drive the human intent loop with authoritative reconciliation

When it is the viewer's turn, the table SHALL offer the legal action for the current phase
(`bid`, `pass`, `declareTrump`, or `playCard`), submit it as an `intent` message carrying a
client-generated `correlationId`, and SHALL reconcile pessimistically against the server's
authoritative `accept` or `reject` reply. It SHALL NOT optimistically mutate rendered game
state before confirmation, and SHALL NOT emit a `bury` intent.

#### Scenario: Accepted move applies the authoritative view

- **WHEN** the viewer submits an intent and the room replies `accept` with the matching
  `correlationId`
- **THEN** the table applies the accepted `view`, clears the pending state, and re-enables
  input when it is again the viewer's turn

#### Scenario: Rejected move re-syncs to the truth view

- **WHEN** the room replies `reject` with the matching `correlationId`
- **THEN** the table applies the authoritative `view` from the reject payload, surfaces the
  rejection reason, and re-enables input without having mutated state optimistically

#### Scenario: Input is gated to the viewer's turn

- **WHEN** it is not the viewer's turn, or an intent is in flight awaiting `accept`/`reject`
- **THEN** the action controls are disabled so no second intent can be submitted

### Requirement: Contribute a per-hand seed on a best-effort basis

On each `commit` message the table SHALL send exactly one `contribute` message with fresh
random client-seed bytes for that hand, and SHALL NOT block rendering or the intent loop on
the contribution or any `rejectContribution` reply.

#### Scenario: Contribution fires once per hand

- **WHEN** a `commit` message arrives for a hand nonce
- **THEN** the client sends a single `contribute { clientSeed }` with freshly generated
  random bytes and does not resend for that same hand

#### Scenario: A dropped contribution does not stall play

- **WHEN** the contribution is not sent or is rejected
- **THEN** the table continues to render and accept turns normally, because the deal's seed
  assembly substitutes a deterministic fallback for the absent contribution

### Requirement: Play a full game to completion and terminal states

The table SHALL support a 1-human + 3-bot Single-Deck Partners game playing through to
match completion, treating the server-initiated disconnect that follows a `matchResult`
view as the success terminal (match complete) state, and a pre-completion drop as an error
state.

#### Scenario: Match completion is a success terminal

- **WHEN** the room delivers a view whose public state carries a final `matchResult` and
  then disconnects the client (the room having persisted the result)
- **THEN** the table renders a match-complete state, not a connection error

#### Scenario: Premature disconnect is an error with a way back

- **WHEN** the connection drops before match completion
- **THEN** the table renders an error state with a return-to-lobby affordance (in-table
  reconnect is deferred)
