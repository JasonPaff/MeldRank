# match-move-clocks Specification

## Purpose

Defines the server-authoritative move clocks the Match room runs for the seat to act: a fresh per-move base allotment each turn, a non-refilling per-player reserve bank, deterministic deadline arithmetic driven by an injected clock seam, the real-timer expiry the Colyseus adapter owns, resolution of expiries through the engine's forced-move policy, per-seat clock state broadcast, and a repeated-timeout abandonment signal. The room is the sole authority over time; a client's locally displayed clock is never authoritative.

## Requirements

### Requirement: Per-move base allotment

Each time a seat becomes the seat to act, the room SHALL grant that seat a fresh per-move **base allotment** for the current turn, independent of any base time left over from its previous turns. The base allotment SHALL be a configured duration carried on the room/match configuration (default 20 seconds) rather than hard-coded, so ranked and casual profiles can diverge without a spec change. The base allotment SHALL be consumed before any reserve time.

#### Scenario: Base resets each turn

- **WHEN** the engine advances so that a new seat is the seat to act
- **THEN** the room grants that seat the configured base allotment for this turn
- **AND** the base allotment does not carry over unused time from that seat's prior turns

#### Scenario: Base value comes from configuration

- **WHEN** a room is created with a configured base allotment
- **THEN** the per-move clock for every seat uses that configured value
- **AND** changing the configuration changes the granted base without any code change

### Requirement: Non-refilling reserve bank

Each seat SHALL have a per-player **reserve bank** that is drawn down only after the current turn's base allotment is exhausted, and that SHALL NOT refill between turns. The reserve bank SHALL be a configured duration (default 90 seconds) initialized once when the seat enters play. When a seat's base for a turn is exhausted, further elapsed time on that turn SHALL deduct from its reserve until the move is made or the reserve reaches zero.

#### Scenario: Reserve drains only after base is gone

- **WHEN** a seat acts within its base allotment
- **THEN** no reserve time is deducted

#### Scenario: Reserve carries the overflow

- **WHEN** a seat's base allotment for a turn is exhausted before it acts
- **THEN** subsequent elapsed time on that turn deducts from the seat's reserve bank
- **AND** the reserve bank is not replenished when the seat's next turn begins

#### Scenario: Reserve persists across turns

- **WHEN** a seat consumes part of its reserve on one turn and later acts again
- **THEN** the seat's remaining reserve reflects the earlier deduction

### Requirement: Server-authoritative deadline via injected clock

The room's time SHALL be server-authoritative, and the pure `RoomCore` SHALL obtain the current time only through an injected clock seam (analogous to the existing `ServerSeedSource`), never by reading a wall clock directly. All deadline arithmetic — computing the moment a seat's combined base plus reserve expires — SHALL be deterministic given the injected time. A client's locally displayed clock SHALL NOT be authoritative.

#### Scenario: Deadline computed from injected time

- **WHEN** a seat begins its turn at an injected time `t`
- **THEN** the room computes the seat's expiry as `t` plus its remaining base plus its remaining reserve
- **AND** the same injected inputs reproduce the identical deadline

#### Scenario: Core does not read a real clock

- **WHEN** `RoomCore` logic runs in a test with a deterministic injected clock
- **THEN** all clock behavior is reproducible without access to the system wall clock

### Requirement: Wall-clock expiry timer in the room adapter

The Colyseus `MatchRoom` adapter SHALL own the real timer: it SHALL translate real elapsed wall-clock time into the injected time supplied to `RoomCore`, and SHALL fire a clock-expiry step when the acting seat's deadline passes without a move. When a move is accepted before the deadline, the adapter SHALL cancel or reschedule the pending expiry for the next seat. The pure core SHALL contain no timers.

#### Scenario: Expiry fires when the deadline passes

- **WHEN** the acting seat's deadline elapses in wall-clock time without an accepted move
- **THEN** the adapter triggers a clock-expiry step in the room core for that seat

#### Scenario: Acting in time cancels the pending expiry

- **WHEN** the acting seat submits an accepted move before its deadline
- **THEN** the adapter cancels the pending expiry and schedules the next seat's expiry

### Requirement: Timeout resolves via the engine forced-move policy

When a seat's clock expires (base and reserve both exhausted), the room SHALL inject the engine `timeout` system event for that seat into `reduce`, which resolves it through the existing `TimeoutMove` policy (auto-pass during the auction, auto-play the lowest-value legal card during trick play), and SHALL run the resulting forced move through the same authoritative apply–advance–broadcast path as a player move. The room SHALL NOT implement its own forced-move logic.

#### Scenario: Auction timeout auto-passes

- **WHEN** the seat to act during the auction lets its clock expire
- **THEN** the room injects the `timeout` event and the engine resolves a forced pass
- **AND** the resulting state is broadcast as for any applied move

#### Scenario: Trick-play timeout auto-plays a legal card

- **WHEN** the seat to act during trick play lets its clock expire
- **THEN** the room injects the `timeout` event and the engine resolves the forced lowest-value legal play
- **AND** the lifecycle advances exactly as if the seat had played that card

#### Scenario: Forced move uses the same broadcast path

- **WHEN** a timeout forced move is applied
- **THEN** each connection receives its filtered view through the same per-recipient broadcast used for player moves

### Requirement: Per-seat clock state broadcast

When the room broadcasts state after a move or clock event, each seat's payload SHALL include the authoritative clock state for the seats it is entitled to see — at minimum the acting seat's remaining base, remaining reserve, and current deadline — so clients can render a synchronized countdown without treating their local clock as authoritative.

#### Scenario: Clock state accompanies the view

- **WHEN** the room broadcasts after a state change
- **THEN** each connection's payload carries the acting seat's remaining base, remaining reserve, and deadline

#### Scenario: Clock state reflects the latest deduction

- **WHEN** a seat acts after consuming part of its reserve
- **THEN** the next broadcast reflects that seat's reduced remaining reserve

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
  </content>
  </invoke>
