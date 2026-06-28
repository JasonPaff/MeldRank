# casual-lobby-web Specification

## Purpose

Defines the web client's casual-lobby surface: the lobby route that resolves the
caller's identity, offers Quick Play to spawn a bot-filled room, and surfaces a
rejoin affordance for an active match — plus the session-store handoff and the F1
table-route stub that close the lobby→table navigation boundary ahead of F2's
Colyseus room join.

## Requirements

### Requirement: Lobby renders the caller's resolved identity

The web client SHALL provide a lobby route that, on load, calls `account.getMe`
through the typed tRPC client and renders the caller's resolved identity (the stub
`playerId` this slice). It SHALL stash the resolved `playerId` into the F0 Zustand
session store. While the call is pending it SHALL render a loading state, and on
failure a non-blocking error state — the first real browser→API round-trip MUST NOT
leave the page in an indefinite blank state.

#### Scenario: Identity loads and is shown

- **WHEN** the lobby route mounts and `account.getMe` resolves
- **THEN** the caller's `playerId` is displayed and written into the session store

#### Scenario: Pending and error states are handled

- **WHEN** `account.getMe` is in flight
- **THEN** the lobby shows a loading state
- **AND** if the call rejects, the lobby shows an error state rather than blank or hanging

### Requirement: Quick Play spawns a bot-filled room and hands off to the table

The lobby SHALL expose a **Quick Play** action that calls `casual.quickPlay`. On
success it SHALL stash the returned seat `ticket` and the active-match handle
(`roomId`, `seat`, `variantId`) into the session store, then navigate to the table
route for that `roomId`. The action SHALL be disabled or show a pending state while
the mutation is in flight so it cannot be double-submitted, and SHALL surface a
typed error without navigating when the mutation rejects.

#### Scenario: Quick Play produces a room and navigates

- **WHEN** the caller clicks Quick Play and `casual.quickPlay` resolves
- **THEN** the returned seat ticket and `{ roomId, seat, variantId }` handle are
  written to the session store
- **AND** the client navigates to the table route for that `roomId`

#### Scenario: Quick Play cannot be double-submitted

- **WHEN** a Quick Play mutation is already in flight
- **THEN** the action is disabled / shows a pending state and issues no second call

#### Scenario: Quick Play failure surfaces without navigating

- **WHEN** `casual.quickPlay` rejects
- **THEN** the lobby shows an error state and does not navigate to a table route

### Requirement: Active-match rejoin affordance

On load the lobby SHALL call `match.getActive`. When it returns a live match the
lobby SHALL surface a **Rejoin** affordance that stashes that match handle into the
session store and navigates to the table route for its `roomId`. When it returns
`null` the lobby SHALL present the Quick Play entry point instead.

#### Scenario: Caller with a live match can rejoin

- **WHEN** `match.getActive` returns a non-null `{ roomId, seat, variantId }`
- **THEN** the lobby shows a Rejoin affordance
- **AND** activating it stashes the handle and navigates to that room's table route

#### Scenario: Caller with no live match sees Quick Play

- **WHEN** `match.getActive` returns `null`
- **THEN** the lobby presents the Quick Play entry point and no Rejoin affordance

### Requirement: Session store lobby→table handoff

The web client SHALL extend the F0 Zustand session store with the lobby→table
handoff fields: the active seat `ticket` and the active-match handle (`roomId`,
`seat`, `variantId`), with setters. These fields carry the data F2's table UI reads
to join the Colyseus room. This capability only writes the handoff; consuming it to
connect a room is out of scope (F2).

#### Scenario: Handoff fields are written by lobby actions

- **WHEN** Quick Play or Rejoin succeeds
- **THEN** the session store holds the seat ticket (when present) and the
  `{ roomId, seat, variantId }` handle for the table route to read

#### Scenario: Handoff is typed and reachable

- **WHEN** a component reads the handoff fields via the session store hook
- **THEN** it receives the typed ticket/handle (or their unset/null initial values)
  without throwing

### Requirement: Table route is an F1 stub that joins no room

The web client SHALL provide a table route (`/table/[roomId]`) that renders the
active-match handle from the session store as an explicit placeholder for F2. In
this slice the route SHALL NOT join, create, or reconnect any Colyseus room and
SHALL NOT render game state — it exists to close the navigation handoff and mark the
F1/F2 boundary.

#### Scenario: Table route renders the handle without connecting

- **WHEN** the table route mounts after a Quick Play or Rejoin navigation
- **THEN** it displays the `roomId`/seat placeholder from the session store
- **AND** initiates no `join`, `joinById`, `create`, or `reconnect` on the Colyseus client
