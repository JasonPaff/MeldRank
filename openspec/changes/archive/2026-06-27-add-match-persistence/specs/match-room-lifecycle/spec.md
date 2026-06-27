## MODIFIED Requirements

### Requirement: Room lifecycle state machine

The room SHALL progress through the states `Reserved → Filling → Live → Complete → Persisted → Disposed`, advancing only along that ordered path. `Reserved` is the created-but-unseated room; `Filling` accepts seat joins until the variant's seat count is reached; `Live` runs the per-hand loop; `Complete` is entered when the engine reports the match complete **or** when an abandonment resolution (forfeit or abort, capability `match-disconnect-abandonment`) terminates the match early, in which case the room carries the resolution reason and per-seat outcomes through the run-out. On entering `Complete` the room SHALL emit a `persist` effect carrying the assembled match record (capability `match-persistence`) and SHALL NOT itself advance to `Persisted`. `Persisted` SHALL be entered only after the durable write of the completed match has confirmed, driven by the adapter; `Disposed` tears the room down and SHALL be reached only from `Persisted` after a completed match (or from a pre-live room). Illegal state transitions SHALL be rejected.

#### Scenario: Room fills then goes live

- **WHEN** a `Reserved` room receives its first join
- **THEN** the room enters `Filling`
- **AND** once the seat count required by the variant is reached, the room enters `Live` and begins the first hand

#### Scenario: Match completion emits persist and awaits the durable write

- **WHEN** the engine reports the match complete during the per-hand loop
- **THEN** the room enters `Complete` and emits a `persist` effect carrying the assembled match record
- **AND** the room advances to `Persisted` only after the durable write confirms, then to `Disposed`

#### Scenario: Abandonment resolution emits persist and awaits the durable write

- **WHEN** an abandonment resolution (forfeit or abort) terminates a `Live` match
- **THEN** the room enters `Complete`, carries the resolution reason and per-seat outcomes, and emits a `persist` effect carrying the assembled record
- **AND** the room advances to `Persisted` only after the durable write confirms, then to `Disposed`

#### Scenario: Out-of-order transition is rejected

- **WHEN** a transition not on the ordered path is attempted (for example `Live → Disposed` skipping `Complete`)
- **THEN** the room rejects the transition and remains in its current state
