# match-disconnect-abandonment Specification

## Purpose

Defines how the Match room handles a seated connection dropping while the room is `Live`: a server-authoritative reconnection grace window per disconnected seat, concurrent operation of the move clock and the grace window, reconnection resync keyed by a stable seat token, and the resolution paths when grace (or the repeated-timeout signal) expires — ranked forfeits, multi-drop/crash aborts with no rating change, a casual reclaimable bot takeover, the abandon event hook for the leaver-penalty layer, and driving the room to its terminal lifecycle.

## Requirements

### Requirement: Disconnect detection and grace window

When a seated connection drops while the room is `Live`, the room SHALL mark that seat `Disconnected` and start a server-authoritative **reconnection grace window** for it, computed as a deadline from the injected clock seam (analogous to the move-clock deadline) and independent of the move clock. The grace duration SHALL be a configured value carried on the room/match configuration (default 90 seconds) so ranked and casual profiles can diverge without a spec change. Marking a seat disconnected SHALL NOT free the seat or mutate engine `State`; the seat assignment is retained so the seat can be reclaimed. A drop while the room has not yet gone `Live` SHALL continue to free the seat as before (this requirement governs only the `Live` room).

#### Scenario: Live drop marks the seat disconnected and starts grace

- **WHEN** a seated connection drops while the room is `Live`
- **THEN** the room marks that seat `Disconnected` and stamps its grace deadline as the injected now plus the configured grace duration
- **AND** the seat assignment is retained and the engine `State` is unchanged

#### Scenario: Grace duration comes from configuration

- **WHEN** a room is created with a configured grace duration
- **THEN** a disconnected seat's grace deadline uses that configured value
- **AND** changing the configuration changes the grace window without any code change

#### Scenario: Pre-live drop still frees the seat

- **WHEN** a connection drops while the room is `Filling`
- **THEN** the seat is freed exactly as before this slice
- **AND** no grace window is started

### Requirement: Move clock and grace run concurrently for a disconnected acting seat

When it becomes a disconnected seat's turn, that seat's move clock (capability `match-move-clocks`) SHALL run alongside its grace window, and the room SHALL resolve on whichever deadline elapses first. A move-clock expiry SHALL resolve through the existing forced-move policy (the grace window continues); a grace expiry SHALL resolve through abandonment handling (this capability). The room's single pending deadline SHALL be the earliest of the contribution-window close, the acting seat's turn expiry, and every disconnected seat's grace deadline.

#### Scenario: Pending deadline is the earliest across timers

- **WHEN** one or more seats are disconnected and a seat is on the move clock
- **THEN** the room's pending deadline is the earliest of the acting seat's turn expiry and every disconnected seat's grace deadline
- **AND** the adapter arms its single timer to that earliest deadline

#### Scenario: Move clock fires before grace

- **WHEN** a disconnected seat is on the move clock and its turn deadline elapses before its grace deadline
- **THEN** the room resolves the timeout through the engine forced-move policy
- **AND** the seat's grace window continues to run

#### Scenario: Grace fires before move clock

- **WHEN** a disconnected seat's grace deadline elapses before its turn deadline
- **THEN** the room resolves the disconnection through abandonment handling rather than a forced move

### Requirement: Reconnection within grace resyncs the seat

A disconnected seat that returns before its grace deadline SHALL be restored to `Connected`, its grace window cleared, and pushed a full authoritative filtered-state resync — its `viewFor` view for the current hand plus the current clock state — so the returning client renders the live table without inferring state from incremental messages. The seat SHALL be reclaimed by its stable seat `token` (the stubbed identity from `match-room-core`), so a new transport session reattaches to the same seat index; engine `State` SHALL be unchanged by the reconnection.

#### Scenario: Return within grace restores and resyncs

- **WHEN** a disconnected seat reconnects before its grace deadline
- **THEN** the room marks the seat `Connected`, clears its grace deadline
- **AND** sends that connection a full `FilteredView` for its seat plus the current clock state

#### Scenario: Reconnection is keyed by stable token

- **WHEN** a seat reconnects on a new transport session presenting its seat token
- **THEN** the room reattaches the new connection to the same seat index
- **AND** the engine `State` is not mutated by the reconnection

#### Scenario: Reconnection after grace is not honored

- **WHEN** a reconnection arrives for a seat whose grace deadline has already passed and been resolved
- **THEN** the room does not restore the seat into a resolved match

### Requirement: Ranked grace expiry resolves as a forfeit

When a disconnected seat's grace window expires in a ranked room and a legitimate result is still possible, the room SHALL resolve the match as a **forfeit** carrying a resolution reason of `forfeit_abandon`, assigning per-seat outcomes: the abandoner an `abandoner_loss` (never softer than a played-out loss), any seat partnered with the abandoner (per the variant's partnership structure) a protected `stranded_partner_reduced_loss`, and every opposing seat a normal `opponent_win`. The room SHALL NOT seat a bot in a ranked match. The resolution SHALL be emitted as an effect carrying the reason and the per-seat outcomes; the rating math that consumes these outcomes lives outside this capability.

#### Scenario: Ranked abandoner forfeits with a full loss

- **WHEN** a disconnected seat's grace expires in a ranked room with a legitimate result still possible
- **THEN** the room resolves with reason `forfeit_abandon`
- **AND** the abandoner's outcome is `abandoner_loss`

#### Scenario: Stranded ranked partner is protected

- **WHEN** a ranked forfeit resolves and the abandoner has a partner seat per the variant
- **THEN** that partner's outcome is `stranded_partner_reduced_loss`
- **AND** every opposing seat's outcome is `opponent_win`

#### Scenario: No bot is seated in ranked

- **WHEN** a ranked seat's grace expires
- **THEN** the room never substitutes a bot for the seat
- **AND** the match resolves through the forfeit path

### Requirement: Ranked repeated-timeout abandonment resolves as a forfeit

When the room emits the ranked repeated-timeout abandonment signal (capability `match-move-clocks`), it SHALL resolve the match through the same forfeit path as a grace expiry, carrying a resolution reason of `timeout_abandon` and the same per-seat outcome assignment (timed-out seat `abandoner_loss`, its partner `stranded_partner_reduced_loss`, opponents `opponent_win`). A player who exhausts its clock bank and then stops acting SHALL be treated as a leaver, not granted unbounded forced moves.

#### Scenario: Crossing the timeout threshold forfeits the match

- **WHEN** a ranked seat accrues clock timeouts past the configured abandonment threshold
- **THEN** the room resolves the match with reason `timeout_abandon`
- **AND** the timed-out seat's outcome is `abandoner_loss`

#### Scenario: Timeout abandonment uses the same outcome assignment

- **WHEN** a `timeout_abandon` forfeit resolves
- **THEN** the abandoner's partner outcome is `stranded_partner_reduced_loss` and opponents are `opponent_win`
- **AND** the resolution flows through the same path as a grace-expiry forfeit

### Requirement: Multi-drop and crash abort with no rating change

When two or more seats in a ranked room are past their grace windows simultaneously such that no legitimate single-forfeit result is possible, the room SHALL **abort** the match carrying a resolution reason of `aborted`, with every seat assigned a `no_result` outcome and no seat penalized. A room lost to a process/room crash SHALL likewise produce no rating change — handled by the absence of a persisted result rather than a manufactured winner. The abort path SHALL never fabricate a winner.

#### Scenario: Two simultaneous ranked drops abort

- **WHEN** a grace expiry fires in a ranked room while another seat is already past its grace window unresolved
- **THEN** the room resolves with reason `aborted`
- **AND** every seat's outcome is `no_result` with no rating change

#### Scenario: Abort never manufactures a winner

- **WHEN** the match aborts for lack of a legitimate result
- **THEN** no seat is assigned a win or loss outcome

#### Scenario: Lost room produces no rating change

- **WHEN** a `Live` room is lost to a crash before any result is persisted
- **THEN** no seat is penalized, consistent with the `aborted` no-result class

### Requirement: Abandon event emitted for the leaver-penalty layer

On any abandonment resolution (`forfeit_abandon` or `timeout_abandon`), the room SHALL emit an abandon event identifying the abandoning seat and the resolution reason, for the separate leaver-penalty layer (escalating cooldowns owned by the Anti-Cheat & Moderation doc). This capability SHALL only emit the hook; it SHALL NOT itself compute penalty thresholds or apply cooldowns. An `aborted` resolution SHALL NOT emit an abandon event, since no seat is charged.

#### Scenario: Forfeit emits an abandon event

- **WHEN** a match resolves as `forfeit_abandon` or `timeout_abandon`
- **THEN** the room emits an abandon event identifying the abandoning seat and the reason

#### Scenario: Abort emits no abandon event

- **WHEN** a match resolves as `aborted`
- **THEN** no abandon event is emitted, because no seat is charged

#### Scenario: Hook does not apply penalties

- **WHEN** an abandon event is emitted
- **THEN** the room performs no cooldown or suspension itself
- **AND** the threshold logic belongs to the leaver-penalty layer

### Requirement: Resolution drives the room to its terminal lifecycle

An abandonment resolution (forfeit or abort) SHALL drive the room through its terminal lifecycle run-out `Complete → Persisted → Disposed` (capability `match-room-lifecycle`), carrying the resolution reason and per-seat outcomes on the room so a downstream persistence slice can emit a faithful result. The `Persisted` transition SHALL remain inert in this slice (no durable write — slice #6 owns persistence and result emission). After resolution the room SHALL accept no further intents.

#### Scenario: Forfeit runs the room out to disposal

- **WHEN** a match resolves as a forfeit
- **THEN** the room advances `Complete → Persisted → Disposed`
- **AND** carries the resolution reason and per-seat outcomes through the run-out

#### Scenario: Persisted transition writes nothing in this slice

- **WHEN** a resolved room reaches `Persisted`
- **THEN** no durable record is written
- **AND** real persistence is deferred to a later slice

#### Scenario: Resolved room rejects further intents

- **WHEN** an intent arrives after the match has resolved
- **THEN** the room does not apply it

### Requirement: Casual grace expiry requests a reclaimable bot takeover

When a disconnected seat's grace window expires in a casual room, the room SHALL mark the seat bot-controlled and emit a bot-takeover request for that seat rather than resolving the match, so the table can complete normally; the returning human SHALL be able to reclaim the seat any time before match end. The bot **decision** logic (slice #5, `apps/bots`) is out of scope: this slice provides only the seating contract behind the same intent interface a human uses, stubbed analogously to the deferred Clerk identity. A casual room SHALL NOT forfeit or abort on a single disconnect.

#### Scenario: Casual grace expiry hands the seat to a bot

- **WHEN** a disconnected seat's grace expires in a casual room
- **THEN** the room marks the seat bot-controlled and emits a bot-takeover request
- **AND** the match is not forfeited or aborted

#### Scenario: Returning human reclaims a bot-controlled seat

- **WHEN** the original player reconnects to a bot-controlled seat before match end
- **THEN** the room restores the seat to that human and resyncs its filtered view

#### Scenario: Bot decision logic is not wired in this slice

- **WHEN** a seat is handed to a bot
- **THEN** the room emits the takeover request through the human-equivalent intent interface
- **AND** the actual bot move generation is deferred to the bots slice
