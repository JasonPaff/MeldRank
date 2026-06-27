# match-room-lifecycle Specification

## Purpose

Defines how the Match Service hosts a single authoritative engine instance per room and drives the room through its lifecycle state machine — from reservation through seat filling, the live per-hand deal loop, match completion, and disposal — without ever exposing full engine state to clients.

## Requirements

### Requirement: One authoritative engine instance per room

The Match Service SHALL host exactly one authoritative `@meldrank/engine` `State` per room, constructed from the room's `VariantDefinition`, and SHALL treat that server-side state as the sole source of truth. Clients SHALL NOT receive the full `State`; the room SHALL expose state to a connection only through the per-seat filtered view (capability `match-intent-loop`).

#### Scenario: Room constructs its engine state on creation

- **WHEN** a room is created with a `VariantDefinition`
- **THEN** the room initializes a single engine `State` for that variant via `createInitialState`
- **AND** no card-bearing private state is sent to any connection at construction time

#### Scenario: Full state is never serialized to a client

- **WHEN** the room broadcasts any update to a connection
- **THEN** the payload is a `FilteredView` (or a protocol message), never the raw engine `State`
- **AND** the payload contains no other seat's hand and no unrevealed widow

### Requirement: Room lifecycle state machine

The room SHALL progress through the states `Reserved → Filling → Live → Complete → Persisted → Disposed`, advancing only along that ordered path. `Reserved` is the created-but-unseated room; `Filling` accepts seat joins until the variant's seat count is reached; `Live` runs the per-hand loop; `Complete` is entered when the engine reports the match complete **or** when an abandonment resolution (forfeit or abort, capability `match-disconnect-abandonment`) terminates the match early, in which case the room carries the resolution reason and per-seat outcomes through the run-out; `Persisted` is a placeholder transition that performs no durable write in this slice; `Disposed` tears the room down. Illegal state transitions SHALL be rejected.

#### Scenario: Room fills then goes live

- **WHEN** a `Reserved` room receives its first join
- **THEN** the room enters `Filling`
- **AND** once the seat count required by the variant is reached, the room enters `Live` and begins the first hand

#### Scenario: Match completion advances toward disposal

- **WHEN** the engine reports the match complete during the per-hand loop
- **THEN** the room enters `Complete`, then `Persisted`, then `Disposed`
- **AND** the `Persisted` transition writes nothing durable in this slice

#### Scenario: Abandonment resolution advances toward disposal

- **WHEN** an abandonment resolution (forfeit or abort) terminates a `Live` match
- **THEN** the room enters `Complete`, then `Persisted`, then `Disposed`
- **AND** carries the resolution reason and per-seat outcomes through the run-out

#### Scenario: Out-of-order transition is rejected

- **WHEN** a transition not on the ordered path is attempted (for example `Live → Disposed` skipping `Complete`)
- **THEN** the room rejects the transition and remains in its current state

### Requirement: Per-hand deal loop while Live

While `Live`, the room SHALL drive the engine through the variant's active path (`resolveActivePath`) one hand at a time: deal a hand, run the intent loop until the hand reaches `HandScoring`, then either deal the next hand or, when `MatchScorer` reports completion, leave the per-hand loop for `Complete`. Each deal SHALL be seeded through the provably-fair handshake (capability `match-shuffle-handshake`).

#### Scenario: Next hand is dealt after scoring

- **WHEN** a hand reaches `HandScoring` and the match is not complete
- **THEN** the room deals the next hand, re-running the shuffle handshake for that hand

#### Scenario: Per-hand loop ends at match completion

- **WHEN** a hand reaches `HandScoring` and `MatchScorer` reports the match complete
- **THEN** the room does not deal another hand and transitions to `Complete`

### Requirement: Seat filling and identity

The room SHALL assign each joining connection a stable seat index for the duration of the room, reject joins once all seats are filled, and reject a join that targets an already-occupied seat. Seat identity SHALL be a stubbed seat token in this slice; Clerk-backed identity and reconnection tokens are out of scope.

#### Scenario: Join is rejected when the room is full

- **WHEN** a connection attempts to join a room whose seats are all occupied
- **THEN** the room rejects the join
- **AND** the room's existing seat assignments are unchanged

#### Scenario: Each seated connection has a stable seat index

- **WHEN** a connection is seated
- **THEN** it is assigned one seat index that does not change while it remains connected
- **AND** that index is the `viewer` the room uses when projecting that connection's filtered view

### Requirement: Room disposal

The room SHALL release its resources and stop accepting messages once it reaches `Disposed`. A room that never fills (no terminal completion) is permitted to dispose. Abandonment handling is governed by capability `match-disconnect-abandonment`; durable persistence remains out of scope for this slice.

#### Scenario: Disposed room rejects further messages

- **WHEN** a room has reached `Disposed`
- **THEN** it accepts no further intents or joins
- **AND** its engine state is released
