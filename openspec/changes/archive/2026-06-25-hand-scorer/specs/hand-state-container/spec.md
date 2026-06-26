## MODIFIED Requirements

### Requirement: Phase-guarded event application

`reduce` SHALL validate each event against the current lifecycle phase and reject any event not legal in that phase, returning the state unchanged (or a typed rejection) without mutation. This change drives the `TrickPlay → HandScoring` slice. `TrickPlay` is a **resting, player-driven** phase: a `playCard` from the seat-to-act, naming a card that the `LegalPlayValidator` reports as legal, is **accepted** and folded into the current trick; a `playCard` out of turn, naming a card not held, or naming an illegal card is rejected and the state is unchanged. `HandScoring` is a **computed, resting** phase with no driving player event: it is reached and scored deterministically when `TrickPlay` empties the hands (see the lifecycle-advancement requirement), and once scored the lifecycle rests there. Events belonging to phases not yet wired (`Bury`, and the `HandScoring → Dealing` / `MatchComplete` branch with any event in `MatchComplete`) SHALL be accepted by the type but rejected by the guard until their phases are implemented.

#### Scenario: An event illegal for the current phase is rejected

- **WHEN** a `bid` event is reduced while the phase is `Dealing`
- **THEN** the event is rejected and the state is unchanged

#### Scenario: A deal event drives the Dealing phase

- **WHEN** a `deal` event carrying a seed is reduced while the phase is `Dealing`
- **THEN** per-seat hands and the widow are populated and the phase advances to `Auction`

#### Scenario: A legal playCard is accepted during TrickPlay

- **WHEN** a `playCard` from the seat-to-act naming a card in the `LegalPlayValidator`'s legal set is reduced while the phase is `TrickPlay`
- **THEN** the card is removed from the seat's hand, appended to the current trick, and the turn passes to the next seat

#### Scenario: An illegal or out-of-turn playCard is rejected

- **WHEN** a `playCard` is reduced during `TrickPlay` from a seat that is not to act, or naming a card the seat does not hold, or naming a card excluded by the legal set
- **THEN** the event is rejected and the state is unchanged

#### Scenario: A later-phase event is not yet driven

- **WHEN** an event whose phase is `MatchComplete`, or that would drive the `HandScoring → Dealing` next-hand branch, is reduced in this change's wired slice
- **THEN** it is rejected by the phase guard (its logic arrives with the `MatchScorer` change) and the state is unchanged

### Requirement: Lifecycle advancement via the transition table

When an event concludes a phase, `reduce` SHALL advance the phase marker to the next phase using the foundation's legal-transition table and the variant's active path (`resolveActivePath`), skipping bracketed phases the variant disables. `reduce` SHALL NOT advance along a transition the table reports as illegal. Where an enabled phase has no driving player event (`WidowReveal`, `Melding`, `HandScoring`), `reduce` SHALL apply it deterministically within the concluding step and pass through to (or rest on) the next phase rather than awaiting an event for it. `TrickPlay` SHALL self-loop while hands hold cards and SHALL advance to `HandScoring` only once all hands are empty after a resolved trick; on that advance `reduce` SHALL deterministically compute the hand score (the `HandScorer` result and the appended score pad) and rest at `HandScoring`.

#### Scenario: TrickPlay self-loops until hands empty

- **WHEN** a trick is resolved during `TrickPlay` and at least one seat still holds cards
- **THEN** the phase remains `TrickPlay` and a fresh trick begins, led by the trick winner

#### Scenario: TrickPlay advances to a scored HandScoring when hands empty

- **WHEN** the final trick of the hand is resolved during `TrickPlay` (all hands now empty)
- **THEN** the phase advances along the legal-transition edge to `HandScoring`, the `HandScorer` result is recorded and its lines appended to the score pad, and the lifecycle rests at `HandScoring`

#### Scenario: HandScoring rests without advancing to the next hand

- **WHEN** the lifecycle has computed the hand score and rests at `HandScoring`
- **THEN** no event advances it to `Dealing` (next hand) or `MatchComplete` in this slice — that branch is the `MatchScorer`'s — and the state is unchanged

#### Scenario: An illegal transition is never taken

- **WHEN** the next-phase advance is computed
- **THEN** `reduce` only follows edges the legal-transition table reports as legal, skipping bracketed phases the active variant disables

### Requirement: Public and private state separation

`State` SHALL separate per-seat private data (each seat's `Hand`, the unrevealed widow) from public data (phase, turn, auction standing, the recorded winning `Bid`, the declared trump, the revealed widow, each melding seat's recorded meld, the in-progress trick, the resolved tricks, the per-seat captured-counter / tricks-taken tally, the scored hand result, and the running score pad) so the Match Service can mechanically derive a per-seat filtered view. Recorded melds and trick plays SHALL be public (meld is laid face-up, "Single-Deck Partners" §6; each play is face-up, §7); the scored hand result and the running score pad SHALL be public (§8/§9, the table sees the score). The engine SHALL structure the state for filtering; performing the filtering is Match Runtime's responsibility ("Match Runtime" §3).

#### Scenario: Private and public regions are distinguishable

- **WHEN** a `State` mid-hand is inspected
- **THEN** each seat's hand and the unrevealed widow are addressable as private, while the phase, whose-turn, auction bids, the declared trump, the revealed widow, recorded melds, the current trick, resolved tricks, the capture tally, the hand result, and the score pad are addressable as public

#### Scenario: Recorded melds are visible to the table

- **WHEN** the phase has advanced past `Melding`
- **THEN** each melding seat's computed meld set and total are present in public state

#### Scenario: The scored hand result is visible at HandScoring

- **WHEN** the lifecycle has computed the hand score and rests at `HandScoring`
- **THEN** the per-side hand result (the scored lines and the made/set verdict) and the running score pad with cumulative-by-side totals are present in public state
