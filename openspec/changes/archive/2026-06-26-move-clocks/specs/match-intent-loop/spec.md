## MODIFIED Requirements

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
