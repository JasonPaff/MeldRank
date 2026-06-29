# table-resilience-web Specification

## Purpose

Defines the web client's table resilience surface layered over table play: an
informational move-clock countdown derived from the room's authoritative clock
payloads, automatic reconnection through the server's grace window after a
mid-game drop, and a room-scoped reconnection token persisted across hard
refreshes so the table can rejoin without a seat ticket. Together these keep a
live game recoverable through transient drops and refreshes without ever
enforcing timeouts client-side or rejoining a finished or abandoned game.

## Requirements

### Requirement: Render the authoritative move-clock countdown

The table SHALL render a live countdown for the seat currently on the clock and SHALL show
each seat's remaining time banks, derived from the move-clock payloads the room already sends
(`clockState` and the synced `clockDeadline`). The countdown SHALL be informational — it SHALL
NOT enforce timeouts (the match server remains the authority) and SHALL clamp at zero rather
than display negative time.

#### Scenario: On-clock seat shows a ticking countdown

- **WHEN** a `clockState` (or synced `clockDeadline`) indicates a pending move deadline for the
  acting seat
- **THEN** the table shows a countdown for that seat computed from the deadline against the local
  clock, updating on a timer and clamped at zero

#### Scenario: Per-seat banks reflect the latest clock payload

- **WHEN** a `clockState` message arrives carrying per-seat `remainingBaseMs` / `remainingReserveMs`
- **THEN** each seat's displayed time banks update to those values

#### Scenario: No countdown when no move is pending

- **WHEN** there is no pending move deadline (no seat on the clock, e.g. between hands or at
  completion)
- **THEN** no active countdown is shown and the table renders without a clock error

### Requirement: Reconnect through the grace window after a mid-game drop

The table SHALL attempt to reconnect using the room's reconnection token within the server's
grace window when the connection drops before match completion and the leave was not
client-initiated, re-attaching its message handlers on success so the server's resync
repopulates the render model. It SHALL NOT immediately forfeit to an error state, and SHALL
fall back to the error / return-to-lobby state only once reconnection can no longer succeed.

#### Scenario: A transient drop reconnects and resyncs

- **WHEN** the room connection drops mid-game (not a client-initiated leave and not after a
  `matchResult` view)
- **THEN** the table enters a `reconnecting` state and calls `client.reconnect(reconnectionToken)`,
  and on success re-attaches handlers, returns to the connected state, and renders the resynced
  authoritative `view` and `clockState` the server re-pushes

#### Scenario: Reconnecting disables input over the last good view

- **WHEN** the table is in the `reconnecting` state
- **THEN** it surfaces a non-blocking reconnecting indicator over the last authoritative view and
  disables the intent controls until the connection is restored

#### Scenario: Grace window exhaustion falls back to the error state

- **WHEN** reconnection attempts do not succeed before the server's grace window closes
- **THEN** the table transitions to the error state with a return-to-lobby affordance

#### Scenario: Match completion is never treated as a reconnectable drop

- **WHEN** the server closes the connection following a view carrying a final `matchResult`
- **THEN** the table renders the match-complete success terminal and does not attempt to reconnect

#### Scenario: A client-initiated leave does not reconnect

- **WHEN** the table itself leaves the room (unmount or navigation)
- **THEN** no reconnection is attempted

### Requirement: Persist and reuse a reconnection token across a hard refresh

The table SHALL persist the room's reconnection token (scoped to the room) on every successful
connect and reconnect, and SHALL clear it on a client-initiated leave, match completion, or a
terminal error. On a cold load with no in-memory seat ticket, the table SHALL use a persisted
token for that room to rejoin without a seat ticket, and SHALL otherwise retain the existing
return-to-lobby behavior.

#### Scenario: Token is persisted on connect and refreshed on reconnect

- **WHEN** the client successfully connects or reconnects to the room
- **THEN** the current reconnection token is persisted, scoped to the room id, replacing any prior
  stored token

#### Scenario: Cold load with a stored token rejoins without a ticket

- **WHEN** the table route mounts with no in-memory seat ticket but a persisted reconnection token
  for that room id
- **THEN** the table calls `client.reconnect(token)` (which requires no seat ticket) and, on
  success, resumes the connected/rendering state from the server resync

#### Scenario: Cold load with no stored token returns to lobby

- **WHEN** the table route mounts with neither an in-memory seat ticket nor a persisted token for
  that room id
- **THEN** the table renders the return-to-lobby affordance and connects nothing

#### Scenario: An expired or invalid stored token fails closed

- **WHEN** reconnection with a persisted token is rejected (grace expired, match resolved, or token
  invalid)
- **THEN** the table clears the stored token and renders the return-to-lobby affordance rather than
  retrying indefinitely

#### Scenario: Terminal states clear the stored token

- **WHEN** the table reaches a terminal state (client-initiated leave, match complete, or error)
- **THEN** the persisted token for that room id is cleared so a later cold load does not rejoin a
  finished or abandoned game
