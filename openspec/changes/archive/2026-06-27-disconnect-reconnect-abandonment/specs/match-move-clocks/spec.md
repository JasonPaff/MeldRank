## MODIFIED Requirements

### Requirement: Repeated-timeout abandonment signal

The room SHALL count consecutive or accumulated clock timeouts per seat, and when a seat crosses a configured timeout threshold in a ranked room, the room SHALL emit an abandonment signal effect identifying the seat. The signal SHALL drive the abandonment resolution defined by capability `match-disconnect-abandonment`: in a ranked room the crossing forfeits the match with resolution reason `timeout_abandon`. This capability SHALL NOT itself compute the per-seat outcomes or run the lifecycle out — it only counts timeouts and raises the signal that triggers resolution. In casual rooms the threshold behavior MAY differ, and no forfeit is taken.

#### Scenario: Threshold crossing emits the signal

- **WHEN** a seat in a ranked room accrues clock timeouts past the configured threshold
- **THEN** the room emits an abandonment signal effect identifying that seat

#### Scenario: Signal drives ranked forfeit resolution

- **WHEN** the abandonment signal is emitted in a ranked room
- **THEN** the match resolves through `match-disconnect-abandonment` with reason `timeout_abandon`
- **AND** this capability does not itself assign outcomes or advance the lifecycle

#### Scenario: Casual timeouts take no forfeit

- **WHEN** a seat in a casual room accrues clock timeouts past the threshold
- **THEN** no forfeit is taken and play continues
