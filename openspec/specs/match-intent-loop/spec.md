# match-intent-loop Specification

## Purpose

Defines the authoritative server-side loop the Match room runs for every `PlayerIntent`: validating intents against the engine state, applying them, advancing the lifecycle, and broadcasting per-seat filtered views. The room is the sole authority; clients reconcile optimistic predictions against authoritative acknowledgements and resyncs.

## Requirements

### Requirement: Authoritative validate–apply–advance–broadcast loop

For every `PlayerIntent` a connection submits, the room SHALL run, in order: validate the intent against the authoritative engine `State`, apply it via the engine `reduce`, advance the lifecycle, then broadcast the resulting per-seat views. An intent that fails validation SHALL NOT mutate state and SHALL produce no broadcast other than the rejection to its submitter. The room SHALL be the only authority; a client's optimistic prediction never mutates server state. As part of advancing, when the engine yields a new seat to act, the room SHALL charge the acting seat's elapsed clock time and grant the next acting seat its fresh base allotment, so clock state advances in lockstep with the engine state. A clock-expiry forced move (injected as the engine `timeout` system event) SHALL flow through this same apply–advance–broadcast path rather than a separate code path.

#### Scenario: Legal intent is applied and broadcast

- **WHEN** a seated connection submits a legal in-turn `PlayerIntent`
- **THEN** the room applies it through the engine `reduce`, advances the lifecycle phase as the engine dictates
- **AND** broadcasts the updated filtered view to every connection

#### Scenario: Illegal intent does not mutate state

- **WHEN** a connection submits an intent the engine rejects as illegal
- **THEN** the engine `State` is unchanged
- **AND** no view update is broadcast to other connections

#### Scenario: Accepted move advances the clock to the next seat

- **WHEN** a legal in-turn move is applied and the engine hands the turn to a new seat
- **THEN** the room charges the acting seat's elapsed time against its base then reserve
- **AND** grants the next acting seat its fresh base allotment

#### Scenario: Timeout forced move reuses the loop

- **WHEN** the acting seat's clock expires and the room injects the `timeout` system event
- **THEN** the resulting forced move is applied, advanced, and broadcast through the same loop as a player move

### Requirement: Turn and seat authority

The room SHALL reject an intent whose `seat` does not match the submitting connection's assigned seat, and SHALL reject an intent submitted by any seat other than the engine's current `seatToAct` (except where the engine's own rules permit it). Authority checks SHALL precede engine application.

#### Scenario: Spoofed seat is rejected

- **WHEN** a connection submits an intent carrying a `seat` value other than its own assigned seat
- **THEN** the room rejects the intent without applying it

#### Scenario: Out-of-turn intent is rejected

- **WHEN** a connection submits an intent while it is not the seat to act
- **THEN** the room rejects the intent without applying it

### Requirement: Per-recipient filtered broadcast at send time

When broadcasting state, the room SHALL compute each recipient's payload by calling `viewFor(state, recipientSeat)` at send time, so each connection receives only the information it is entitled to. Spectators (where present) SHALL receive the spectator view (`viewer === null`). The room SHALL NOT compute one shared payload and reuse it across seats.

#### Scenario: Each seat receives only its own view

- **WHEN** the room broadcasts after a state change
- **THEN** each seated connection receives the `FilteredView` produced by `viewFor` for its own seat
- **AND** no connection's payload contains another seat's hand or the unrevealed widow

#### Scenario: View is projected per recipient, not shared

- **WHEN** two seats with different hands are sent an update for the same state
- **THEN** each receives a distinct payload reflecting its own `own` region

### Requirement: Optimistic/authoritative reconciliation protocol

The wire protocol SHALL let a client submit an intent and receive an acknowledgement that is either an **accept** — carrying the authoritative resulting view — or a **reject** — carrying a machine-readable reason and a corrective resync of the submitter's authoritative view. Acknowledgements SHALL be correlated to the submitted intent so a client can match a response to its optimistic prediction and roll back on reject.

#### Scenario: Accepted intent acknowledges with authoritative view

- **WHEN** a submitted intent is applied
- **THEN** the submitter receives an accept acknowledgement correlated to that intent
- **AND** the acknowledgement carries the submitter's authoritative resulting view

#### Scenario: Rejected intent triggers corrective resync

- **WHEN** a submitted intent is rejected
- **THEN** the submitter receives a reject acknowledgement with a machine-readable reason
- **AND** a resync of the submitter's authoritative filtered view, so an optimistic client can roll its prediction back

### Requirement: Full state resync on join

When a connection is seated (or re-enters its seat within this slice's stubbed model), the room SHALL send it a complete, authoritative `FilteredView` for its seat so the client can render the current table without inferring state from incremental messages.

#### Scenario: Newly seated connection receives a full view

- **WHEN** a connection takes a seat in a `Live` room
- **THEN** it immediately receives the full `FilteredView` for its seat reflecting the current hand
