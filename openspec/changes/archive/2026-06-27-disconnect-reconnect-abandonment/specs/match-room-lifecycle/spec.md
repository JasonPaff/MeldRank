## MODIFIED Requirements

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

### Requirement: Room disposal

The room SHALL release its resources and stop accepting messages once it reaches `Disposed`. A room that never fills (no terminal completion) is permitted to dispose. Abandonment handling is governed by capability `match-disconnect-abandonment`; durable persistence remains out of scope for this slice.

#### Scenario: Disposed room rejects further messages

- **WHEN** a room has reached `Disposed`
- **THEN** it accepts no further intents or joins
- **AND** its engine state is released
