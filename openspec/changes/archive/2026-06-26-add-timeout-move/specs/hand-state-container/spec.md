## MODIFIED Requirements

### Requirement: Phase-guarded event application

`reduce` SHALL validate each event against the current lifecycle phase and reject any event not legal in that phase, returning the state unchanged (or a typed rejection) without mutation. `TrickPlay` is a **resting, player-driven** phase: a `playCard` from the seat-to-act, naming a card that the `LegalPlayValidator` reports as legal, is **accepted** and folded into the current trick; a `playCard` out of turn, naming a card not held, or naming an illegal card is rejected and the state is unchanged. `HandScoring` is a **computed, resting** phase with no driving player intent: it is reached and scored deterministically when `TrickPlay` empties the hands (see the lifecycle-advancement requirement). When the match is not over, the lifecycle rests at `HandScoring` and a `deal` event (carrying a fresh seed) is **accepted** there to start the next hand; when the match is over, `HandScoring` advances deterministically to `MatchComplete` instead of resting. `deal` is therefore legal in both `Dealing` (the first hand) and `HandScoring` (subsequent hands) and rejected in every other phase. `MatchComplete` is **terminal**: every event is rejected and the state is unchanged. `Bury` remains accepted by the type but rejected by the guard until its phase is implemented.

A `timeout` system event SHALL be resolved uniformly through `TimeoutMove`: when its `seat` is the current seat-to-act, `reduce` SHALL compute the forced intent via `TimeoutMove(state)` and apply it through the **identical** path the equivalent player intent would take (so the forced move passes the same phase, turn, and legality guards as a human move). When the `timeout` names a seat that is not to act, or `TimeoutMove` defines no forced move for the current phase (returns `null`), `reduce` SHALL leave the state unchanged. This is the single resolution point for `timeout` in every phase; no phase branch handles `timeout` inline.

#### Scenario: An event illegal for the current phase is rejected

- **WHEN** a `bid` event is reduced while the phase is `Dealing`
- **THEN** the event is rejected and the state is unchanged

#### Scenario: A deal event drives the Dealing phase

- **WHEN** a `deal` event carrying a seed is reduced while the phase is `Dealing`
- **THEN** per-seat hands and the widow are populated and the phase advances to `Auction`

#### Scenario: declareTrump is driven and Melding is applied

- **WHEN** a `declareTrump` from the contract winner naming a valid suit is reduced while the phase is `DeclareTrump`
- **THEN** the trump is recorded, each melding seat's meld is computed and recorded, and the phase advances past `Melding` to the variant's next active phase

#### Scenario: A legal playCard is accepted during TrickPlay

- **WHEN** a `playCard` from the seat-to-act naming a card in the `LegalPlayValidator`'s legal set is reduced while the phase is `TrickPlay`
- **THEN** the card is removed from the seat's hand, appended to the current trick, and the turn passes to the next seat

#### Scenario: An illegal or out-of-turn playCard is rejected

- **WHEN** a `playCard` is reduced during `TrickPlay` from a seat that is not to act, or naming a card the seat does not hold, or naming a card excluded by the legal set
- **THEN** the event is rejected and the state is unchanged

#### Scenario: A timeout for the seat-to-act applies the forced move

- **WHEN** a `timeout` naming the seat-to-act is reduced while the phase is `Auction` (and again while the phase is `TrickPlay`)
- **THEN** the forced intent from `TimeoutMove` is applied — the seat passes during `Auction`, and during `TrickPlay` the seat's lowest-value legal card is played — exactly as if that intent had been submitted by the seat

#### Scenario: A timeout for a non-acting seat or undefined-policy phase is a no-op

- **WHEN** a `timeout` naming a seat that is not the seat-to-act is reduced, or a `timeout` is reduced while the phase defines no forced move (e.g. `DeclareTrump`)
- **THEN** the event is rejected and the state is unchanged

#### Scenario: A deal starts the next hand from a resting HandScoring

- **WHEN** a `deal` event carrying a fresh seed is reduced while the phase is `HandScoring` and the match is not over
- **THEN** the dealer is rotated one seat, the per-hand state is reset while the running score pad and match-scope counters are preserved, new hands and widow are dealt, and the phase advances to `Auction`

#### Scenario: MatchComplete rejects all events

- **WHEN** any event is reduced while the phase is `MatchComplete`
- **THEN** the event is rejected and the state is unchanged
